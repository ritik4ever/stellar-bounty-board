# Soroban Contract Event Indexer Worker

This worker polls Soroban contract events and normalizes them for backend use. It is isolated from the main API server and can be run as a separate process.

## How It Works

- Polls the Soroban RPC endpoint for contract events (create, reserve, submit, release, refund, dispute)
- Decodes Soroban XDR topics and values, then normalizes events into backend-friendly records. For `(Bounty, Submit)`, the record includes the bounty ID and contributor from the `BountySubmitted` payload without a follow-up contract read. For `(Bounty, Refund)`, the record includes the bounty ID, maintainer, and refunded amount from the `BountyRefunded` payload without a follow-up contract read. For `(Bounty, Dispt)`, the record includes the bounty ID, contributor, and arbiter from the `BountyDisputed` payload without a follow-up contract read. For `(Bounty, Releas)`, the record includes the bounty ID, contributor, maintainer, and released amount from the `BountyReleased` payload without a follow-up contract read.
- Appends new events to a local file (`indexed-events.json`) and saves a cursor checkpoint (`indexed-events.cursor.json`) after each page, so an interrupted backfill resumes where it stopped instead of replaying the whole ledger
- Handles errors gracefully so failures do not affect the main API server

## Event Topics

Events are emitted by the contract with a two-element topic array of the form
`(Symbol("Bounty"), Symbol("<Transition>"))`. The worker maps the second topic to a
stable event type string:

| Topic[1]   | `event.type` | Payload struct     | Extracted fields                             |
|------------|--------------|------------------|---------------------------------------------------|
| `Create`   | `create`      | `BountyCreated`    | bounty ID, maintainer, amount 
|CrtEvent	created	BountyCreatedEvent	bounty ID, maintainer, token, amount, repo, issue number, title, deadline, protocol fee bps, dispute window override, created at
| `Reserv`   | `reserve`     | `BountyReserved`   | bounty ID, contributor                            |
| `Submit`   | `submit`      | `BountySubmitted`  | bounty ID, contributor                            |
| `Releas`   | `release`      | `BountyReleased`   | bounty ID, contributor, maintainer, amount           |
| `Refund`   | `refunde`      | `BountyRefunded`   | bounty ID, maintainer, amount                      |
| `Dispt`    | `disputed`     | `BountyDisputed`    | bounty ID, contributor, arbiter                      |

### Release event

`Wrelease_bounty` emits a structured event with the topic `(Bounty, Releasa)` and a
`BountyReleased` payload containing `bounty_id`, `contributor`, `maintainer`, and `amount`.
The worker normalizes this into a record with `type: "release"`, the bounty ID, the
contributor, the maintainer, and the released amount -- all derived from the event
payload alone. No follow-up contract read is required to react to the release
transition.

### Create event

`create_bounty` emits a structured event with the topic `(Bounty, CrtEvent)` and a `BountyCreatedEvent` payload containing `bounty_id`, `maintainer`, `token`, `amount`, `repo`, `issue_number`, `title`, `deadline`, `protocol_fee_bps`, `dispute_window_override`, and `created_at`. The worker normalizes this into a record with `type: "created"` and the same fields in camelCase, all derived from the event payload alone. No follow-up contract read is required to react to the create transition.

The older `(Bounty, Create)` event is unchanged and still maps to `type: "create"`.

## Usage

1. Set environment variables:
   - `SOROBAN_CONTRACT_ID` (required): The contract ID to index
   - `SOROBAN_RPC_URL` (optional): Soroban RPC endpoint (default: `https://rpc-futurenet.stellar.org`)
   - `SOROBAN_START_LEDGER` (required on a fresh install): Ledger to start the first backfill from; ignored once a cursor checkpoint exists
   - `SOROBAN_POLL_INTERVAL` (optional): seconds between polls (default: `10`)
   - `SOROBAN_INDEXER_MAX_RETRIES` (optional): attempts per page before giving up until the next poll; whole number >= 1 (default: `5`)
   - `SOROBAN_INDEXER_INITIAL_BACKOFF_MS` (optional): delay before the first retry in milliseconds, doubling on each further attempt (default: `1000`)
   - `SOROBAN_INDEXER_CURSOR_FILE` (optional): cursor checkpoint path (default: `indexed-events.cursor.json` next to the events file)

   Invalid values (non-numeric, zero, negative) fall back to the default rather than failing. The effective values are logged once at startup (`[Indexer] Effective config: ...`).

2. Run the worker:

```bash
cd backend/worker
node indexer.js
```

## Backfill and restart safety

The worker calls the Soroban JSON-RPC `getEvents` method and fetches **one page
per poll** (limit 100), using the RPC cursor. After normalizing a page it writes
the events file atomically, then writes the cursor checkpoint atomically. On a
restart it resumes from that cursor. Older installs with no checkpoint fall back
to the last event ID in `indexed-events.json`; a completely fresh install needs
`SOROBAN_START_LEDGER`.

If the RPC request fails, or the process dies before the checkpoint is written,
the cursor stays on the last committed page. The next poll retries that page.
Replayed events are deduplicated by event ID, so a page that was already written
is not written twice. A missing page is therefore retried, and committed effects
are neither lost nor duplicated.

`backend/test/workerBackfill.test.ts` covers overlapping pages, a failure
between pages, and resumption from the stored cursor.

### Multi-event ledger cursor boundary behavior

When multiple events occur within the same ledger (sharing the same `ledger` sequence number but possessing distinct event IDs and paging tokens):
- The indexer processes all events in strict sequential order.
- Each event is normalized with its `ledger` sequence number (`ledger: Number(event.ledger)`).
- All events within the ledger are recorded without dropping any event.
- Deduplication against existing event IDs (`knownIds`) prevents duplicate entries.
- The stored cursor (`nextCursor`) checkpoints to the latest event's paging token / ID (or `result.cursor`).
- On restart or resumption from that cursor, subsequent polls begin strictly after that boundary, ensuring no events in the ledger are skipped or duplicated.

## Event backfill

`eventBackfill.js` re-reads a bounded ledger range and merges the events into
the same `indexed-events.json` file the live worker uses. It is an operator
tool, not a public endpoint.

### Security model

Backfill input is untrusted, so every run must be authenticated and validated
before any RPC call:

- `SOROBAN_BACKFILL_TOKEN` must be set; if it is missing, **every** request is
  rejected (fail closed).
- The operator token is supplied only through the environment, never through
  `--input` or the command line, so it does not land in shell history or
  process listings. It is compared in constant time and never appears in logs
  or error messages.
- The request may contain only `startLedger`, `endLedger` and `cursor`.
  Unknown fields (an `rpcUrl`, `contractId`, `events`, …) are rejected so a
  caller cannot redirect the job or inject events.
- The RPC endpoint and contract ID come from the environment
  (`SOROBAN_RPC_URL`, `SOROBAN_CONTRACT_ID`). RPC failures are reported as a
  generic message because providers may embed an API key in the endpoint URL.
- A response is validated before anything is written: `result.latestLedger`
  must be present, `result.events` must be an array (a missing page is an
  error, not an empty page), and every event must belong to the configured
  contract, have a usable id, an integer ledger and an XDR topic list. An
  undecodable event rejects the whole page.

### Usage

```bash
SOROBAN_BACKFILL_TOKEN=... SOROBAN_CONTRACT_ID=C... node eventBackfill.js \
  --input '{"startLedger": 1000, "endLedger": 1500}'
```

`--input` also accepts `@path/to/request.json`. The request schema:

| Field        | Type                     | Rules                                                  |
|--------------|--------------------------|--------------------------------------------------------|
| `startLedger`| positive integer         | Inclusive start of the range                           |
| `endLedger`  | positive integer         | Inclusive end; `startLedger <= endLedger`             |
| `cursor`     | short paging token       | Optional, max 256 chars of `[A-Za-z0-9+/=_-]`         |

The range is capped at 5,000 ledgers and 50 RPC pages per run so a single
invocation stays bounded; use several runs for larger ranges.

### Overlap, retries and failure isolation

- **Overlapping live polling:** events are deduplicated by chain identity
  (`id`, or ledger + event index when there is no id). Existing entries in
  `indexed-events.json`, including those written by live polling, are never
  removed or rewritten; only unseen events are appended.
- **Whole-ledger retry:** a page is merged and the sidecar cursor
  (`indexed-events.json.backfill-cursor.json`) advanced only after the merge
  succeeds. If the RPC page, decoding, or the merge fails, the cursor stays at
  the last fully merged ledger and the next run re-reads that ledger from the
  start. Deduplication makes the re-read a no-op.
- **Crash between merge and cursor write:** the events are already durable and
  uniquely identified; the retry counts them as skipped and advances the
  cursor.
- **Out-of-range events:** events newer than `endLedger` are not persisted.
- The exit code is non-zero for any rejected or failed run, and the error
  message includes a stable code (`unauthorized`, `invalid_request`,
  `missing_rpc_page`, `malformed_rpc_response`, `malformed_event`,
  `store_error`).

## Architecture

- The worker is completely isolated from the main API server.
- It can be run as a background process or managed by a process manager (e.g., PM2, systemd).
- Events are normalized using a mapping function and stored for backend consumption.
- Extend the normalization logic as the contract evolves.

## Extending

- Replace file storage with a database for production use.
- Add more robust error handling and alerting as needed.
- Integrate with backend API or event consumers if required.

---

For questions, see the main [README.md](../READMEO.md) or open an issue.
