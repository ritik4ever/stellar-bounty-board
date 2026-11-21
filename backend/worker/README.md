# Soroban Contract Event Indexer Worker

This worker polls Soroban contract events and normalizes them for backend use. It is isolated from the main API server and can be run as a separate process.

## How It Works

- Polls the Soroban RPC endpoint for contract events (create, reserve, submit, release, refund, dispute)
- Decodes Soroban XDR topics and values, then normalizes events into backend-friendly records. For `(Bounty, Submit)`, the record includes the bounty ID and contributor from the `BountySubmitted` payload without a follow-up contract read. For `(Bounty, Refund)`, the record includes the bounty ID, maintainer, and refunded amount from the `BountyRefunded` payload without a follow-up contract read. For `(Bounty, Dispt)`, the record includes the bounty ID, contributor, and arbiter from the `BountyDisputed` payload without a follow-up contract read. For `(Bounty, Releas)`, the record includes the bounty ID, contributor, maintainer, and released amount from the `BountyReleased` payload without a follow-up contract read.
- Appends new events to a local file (`indexed-events.json`) for demonstration (replace with DB logic as needed)
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
   - `SoROBAN_CONTRACT_ID` (required): The contract ID to index
   - `SOROBAN_RPC_URL` (optional): Soroban RPC endpoint (default: `https://rpc-futurenet.stellar.org`)
   - `SOROBAN_POLL_INTERVAL` (optional): seconds between polls (default: `10`)
   - `SoROBAN_INDEXER_MAX_RETRIES` (optional): attempts per poll before giving up until the next poll; whole number >= 1 (default: `5`)
   - `SOROBAN_INDEXER_INITIAL_BACKOFF_MS` (optional): delay before the first retry in milliseconds, doubling on each further attempt (default: `1000`)

   Invalid values (non-numeric, zero, negative) fall back to the default rather than failing. The effective values are logged once at startup (`[Indexer] Effective config: ...`).

2. Run the worker:

```bash
cd backend/worker
node indexer.js
```

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
