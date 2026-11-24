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

## HTTP contract summary

| Situation                                              | Status                            |
| ------------------------------------------------------ | --------------------------------- |
| Transition committed                                   | `200`                             |
| Bounty ID does not exist                               | `404`                             |
| Illegal status for the transition                      | `400`                             |
| `expectedVersion` stale                                | `409` (`BOUNTY_VERSION_CONFLICT`) |
| Store lock not acquired within `STORE_LOCK_TIMEOUT_MS` | `503`                             |
| Store read/write failure                               | `500`                             |

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

- `backend/test/concurrentStateUpdates.test.ts` — store-level races (reserve vs
  refund, pinned version, worker expiry), the HTTP `409` contract, and
  "no 503 under contention".
- `backend/test/concurrency.test.ts` — many simultaneous reserve requests yield
  exactly one `200` and defined conflicts.
- `backend/test/reservationExpirationJob*.test.ts` — worker expiry behaviour.
