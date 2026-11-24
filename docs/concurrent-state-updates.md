# Concurrent bounty state updates

Status: current behaviour after #1925.

A bounty's record carries a monotonic `version` (starting at `1`). Every
committed transition — reserve, refund, cancel, submit, release, expire, notes
update, deadline extension, PR merge — writes `version + 1` exactly once, appends
one event, and appends one audit entry.

## The boundary

All writers serialize on a single cross-process file lock keyed by the bounty
store path (`BOUNTY_STORE_PATH`):

| Writer                                                   | Lock                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| reserve / refund / cancel                                | store file lock                                                  |
| submit / release / dispute resolution / notes / deadline | store file lock                                                  |
| reservation-expiry worker                                | store file lock (via `expireStaleReservations` in `bountyStore`) |
| lazy deadline/reservation normalization on read          | no lock (records are only expired; see Limitations)              |

Because every writer re-reads the store **inside** the lock, a writer never acts
on the snapshot it read before the lock. The lock is acquired with a bounded
retry budget (`STORE_LOCK_TIMEOUT_MS`, default 5000 ms), so concurrent writers
queue instead of failing immediately. A caller that cannot get the lock within
the budget receives `503` (dependency failure) rather than a state error.

## Reserve and refund arriving at the same version

Two cases, both defined:

1. **No `expectedVersion` supplied.** The store applies the transitions in
   whatever order the lock grants. Both reserve (from `open`) and refund (from
   `open` or `reserved`) are legal, so a reserve followed by a refund commits two
   transitions and the version advances by two. No update is lost: the later
   writer reads the earlier writer's record. A refund that lands first makes the
   reserve fail with `400 Only open bounties can be reserved.`
2. **`expectedVersion` supplied** (reserve body, refund body). The writer
   asserts the version it read. Exactly one of the racing transitions commits;
   the other receives:

   ```
   HTTP/1.1 409 Conflict
   {
     "error": "Bounty is at version 2, not the expected version 1. Refresh the bounty and retry.",
     "code": "BOUNTY_VERSION_CONFLICT",
     "currentVersion": 2,
     "currentStatus": "reserved",
     "requestId": "..."
   }
   ```

   Retrying with `expectedVersion: 2` then succeeds (if still legal).

`BOUNTY_STATE_CONFLICT` is reserved for callers that keep a state check separate
from the version check; the store's own transitions report state problems as
`400` and version problems as `409`.

## Reservation expiry (worker boundary)

`expireStaleReservations(ttlSeconds)` runs inside the store lock and re-reads the
store, so a worker tick can never write a snapshot that predates a request:

- a reservation that was refunded/released/submitted while the worker was
  deciding is left alone (status is no longer `reserved`);
- an expired reservation moves `reserved → open`, clears `contributor` and
  `reservedAt`, increments the version once, and writes one `expire` audit
  entry with `reason: reservation_ttl_exceeded`;
- a caller still holding the pre-expiry version gets `409` on its next
  transition instead of silently overwriting the expiry.

## Worker failure, restart, and replay

When concurrent workers contend for the same bounty version (e.g. one worker reserving and another refunding) and one worker fails or crashes mid-stream while the other commits:

1. **Exactly one legal transition commits:** File lock serialization ensures only the winning worker executes its transition and increments the bounty version monotonically.
2. **Crash & restart safety:** Upon process or worker restart, the persisted JSON store reflects the single committed state with its updated version.
3. **Replay protection:** When the failed worker restarts and replays its original mutation with the stale `expectedVersion`:
   - It is rejected with `BOUNTY_VERSION_CONFLICT` (409) identifying the updated current version and status.
   - The bounty's persisted version and events remain intact without duplicate side-effects.
   - If the transition remains legal in the current status, the worker can refresh the current version and successfully commit `version + 1`.

## Outcome tracing for concurrent state updates (#1928)

Every state update transition (`reserve`, `refund`, `expire`, `cancel`, `submit`, `release`, `pr_merged`) emits structured trace records so operators can observe in-flight and committed work:

1. **`pending` trace emitted before lock acquisition / persistence:** When a transition is initiated, a `pending` record is emitted with the target `bountyId`, `transition`, `expectedVersion`, and a redacted reference (`eventRef`, `deliveryRef`, `cursorRef`).
2. **`committed` trace emitted after store persistence:** Upon durable storage write and audit appending, a `committed` record is emitted with the new `currentVersion`, `fromStatus`, `toStatus`, and the matching `eventRef`.
3. **`failed` trace emitted on conflict or error:** If a worker's expected version does not match (e.g. because another worker already committed a transition), a `failed` record is emitted with `error: 'BOUNTY_VERSION_CONFLICT'`, `expectedVersion`, and `currentVersion`.

### Trace record schema

Each log line is emitted as a structured JSON record prefixed with `[StateUpdate][trace]`:

```json
{
  "event": "concurrent_bounty_state_update",
  "outcome": "pending",
  "at": "2026-11-24T17:00:18.769Z",
  "bountyId": "BNT-0001",
  "transition": "reserve",
  "eventRef": "sha256:a3a43b86e50f82fe",
  "deliveryRef": null,
  "cursorRef": null,
  "expectedVersion": 1,
  "currentVersion": null,
  "fromStatus": null,
  "toStatus": null,
  "actorRef": "sha256:a0499a7bc95c810c",
  "workerId": "worker-1",
  "error": null,
  "reason": null
}
```

### Distinguishing pending events from committed transitions

- **Clean commit:** An operator sees `pending` followed by `committed` sharing the same `eventRef`.
- **GitHub webhook out-of-order close (#1943):** An operator sees an initial `pending` record with `transition: 'pr_merged'`, `bountyId: 'unmatched'`, and a redacted `deliveryRef: 'sha256:...'`. When the bounty submission is recorded and the delivery is applied, the operator sees matching `committed` records with the exact same `deliveryRef`, confirming the transition committed.
- **Invalid HMAC signature (#1943):** When webhook verification fails, a `failed` record is emitted with `transition: 'webhook_signature_verify'`, `error: 'invalid_hmac_signature'`, and redacted `deliveryRef` and `eventRef`.
- **Worker failure after another commits:** When two workers race on version 1:
  - Both emit `pending` with distinct `eventRef` digests.
  - The winning worker acquires the lock, advances the version to 2, and emits `committed`.
  - The losing worker acquires the lock, observes current version 2, and emits `failed` (`error: BOUNTY_VERSION_CONFLICT`).
  - If a worker crashes before acquiring the lock, only `pending` exists for its `eventRef`. On restart and replay, it emits `pending` followed by `failed`, confirming to operators that the stale replay was safely rejected.

### Redaction guarantees

- **Raw secrets and tokens are never logged:** All raw identifiers, delivery IDs, cursor tokens, and Stellar secret keys (`S...`) are converted to truncated SHA-256 digests (`sha256:` + 16 hex chars).
- Public metadata (`bountyId`, `transition`, versions, status) is retained for operational correlation without leaking sensitive data.

## HTTP contract summary

| Situation                                              | Status                            |
| ------------------------------------------------------ | --------------------------------- |
| Transition committed                                   | `200`                             |
| Bounty ID does not exist                               | `404`                             |
| Illegal status for the transition                      | `400`                             |
| `expectedVersion` stale                                | `409` (`BOUNTY_VERSION_CONFLICT`) |
| Store lock not acquired within `STORE_LOCK_TIMEOUT_MS` | `503`                             |
| Store read/write failure                               | `500`                             |

## Interrupted store writes and resume (SBB-2026-452/457)

Every locked writer first runs `resumeInterruptedStoreWrites()` inside the
store lock, before reading state. `atomicWriteJson` leaves a
`.<name>.tmp-{pid}-{ms}-{counter}` sibling when a process dies between the temp
write and the atomic rename. The resume pass completes the newest temp whose
payload parses and passes the store's write validator (bounty records for
`bounties.json`, audit records for `bounties.audit.json`); corrupt, stale, or
invalid temps are deleted. Because the pass runs inside the same lock every
transition uses, a concurrent state update interrupted mid-flight is finished
before the next transition computes its read-modify-write — the next writer
observes the resumed version and gets a defined `409`/`400` instead of acting
on a stale snapshot. Write outcomes (pending/committed/failed, including
resumed completions) are traced as `bounty_store_write` records.

## Limitations

- The store is a JSON file guarded by a file lock; it is not a transactional
  database. Read paths (`listBounties`) may lazily normalize an overdue
  deadline/reservation and write without the lock. That path only expires
  records and now also bumps the version, but a caller reading concurrently can
  still observe the pre-normalization record.
- A process killed while holding the lock leaves a stale lock that
  `proper-lockfile` considers held for up to 10 seconds; writers get `503` until
  then.

## Tests

- `backend/test/stateUpdateTrace.test.ts` — outcome tracing unit and integration
  tests (`pending`, `committed`, `failed`), secret and reference redaction, and
  distinguishing pending from committed work across worker failures and replays (#1928).
- `backend/test/concurrentStateUpdates.test.ts` — store-level races (reserve vs
  refund, pinned version, worker expiry), the HTTP `409` contract, and
  "no 503 under contention".
- `backend/test/concurrency.test.ts` — many simultaneous reserve requests yield
  exactly one `200` and defined conflicts.
- `backend/test/reservationExpirationJob*.test.ts` — worker expiry behaviour.
- `backend/test/bountyStoreWriteResilience.test.ts` — interrupted write resume,
  write-input validation, and `bounty_store_write` outcome tracing.
