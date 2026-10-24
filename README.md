# Stellar Bounty Board

![CI](https://github.com/ritik4ever/stellar-bounty-board/actions/workflows/ci.yml/badge.svg)

Stellar Bounty Board is a contribution-focused Stellar MVP for open source maintainers.

It includes:

- A React dashboard to publish and manage GitHub issue bounties
- A Node.js/Express API with JSON persistence for bounty lifecycle actions
- A Soroban contract scaffold for on-chain escrow and payout logic
- Ready-to-open issue drafts so the repo itself is easy to grow through contributions

## What It Does?

Maintainers can fund a GitHub issue as a Stellar bounty, contributors can reserve the work, submit a PR link, and the maintainer can release or refund the escrow.

Current MVP behavior:

- Create issue-linked bounties
- Browse bounty status and urgency
- Reserve a bounty as a contributor
- Attach a PR submission link
- Release payout or refund escrow
- Opt-in notifications (webhook & email) on state changes (reserve, submit, release, refund, dispute)
- Surface contribution-ready follow-up issues in the UI and docs

## Project Structure

Frontend (`frontend`, default port `3000`)

- React + Vite
- Dashboard for bounty creation and lifecycle actions

Backend (`backend`, default port `3001`)

- Express REST API
- File-backed JSON persistence in `backend/data/bounties.json`
- Validation with Zod

Contract (`contracts`)

- Soroban Rust contract scaffold
- Escrow-style bounty lifecycle methods

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system architecture, data ownership, and deployment diagrams.

The [bounty lifecycle sequence diagram](docs/ARCHITECTURE.md#bounty-lifecycle-sequence) shows the create, reserve, submit, release, refund, dispute, and resolution flows across Maintainer, Contributor, Arbiter, Backend, and Contract actors.

## Arbitration Flow

Stellar Bounty Board uses an on-chain arbiter to resolve disputes fairly without requiring either party to trust the other.

### Roles

| Role            | Description                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------- |
| **Maintainer**  | Creates and funds the bounty escrow.                                                              |
| **Contributor** | Reserves the bounty and submits a pull request for review.                                        |
| **Arbiter**     | A trusted third-party address that resolves disputes. Configured once at contract initialisation. |

### Configuration

Set the arbiter's Stellar public key in your environment before starting the backend:

```
# .env
ARBITER_ADDRESS=G...your_arbiter_stellar_public_key...
```

Verify dependency health with the deep check:

```bash
curl http://localhost:3001/api/health/deep
# {
#   "overall": "up",
#   "components": {
#     "store": "up",
#     "soroban": "up",
#     "contract": "up",
#     "auth": "up"
#   },
#   "timestamp": "2026-06-28T12:00:00.000Z"
# }
```

Each component check has a 5-second timeout by default. Configure the per-component
timeout in milliseconds with `DEEP_HEALTH_CHECK_TIMEOUT_MS`; checks that exceed it
are reported as down.

If any component is `"down"`, the endpoint returns HTTP 503. Set `MAINTAINER_PUBLIC_KEY`, `ARBITER_ADDRESS`, and `SOROBAN_CONTRACT_ID` in your environment, and ensure the Soroban RPC URL is reachable.

### Dispute lifecycle

1. **Maintainer raises a dispute** — after the work is submitted, the maintainer can open a dispute within the on-chain dispute window.
2. **Arbiter reviews** — the arbiter examines the submitted work off-chain (PR, deliverables, communication).
3. **Arbiter resolves on-chain** — the arbiter calls `dispute_bounty` on the Soroban contract with the bounty ID and their address. The contract verifies the caller matches the stored `ARBITER_ADDRESS`.
4. **Funds are released** — the contract releases the escrowed tokens to either the contributor (work accepted) or the maintainer (work rejected / refund).

The arbiter address is immutable after `initialize` is called on the contract — rotate it only by redeploying the contract.

### Dispute UI Surface

Maintainers and arbiters interact directly with the arbitration flow through the Bounty Detail page (`/bounties/:id`):

- **Maintainer Review & Dispute Action:** When a bounty is in `submitted` status and within the review deadline window, maintainers can click **Raise Dispute** to open the dispute form, provide the dispute rationale (up to 500 characters), and submit the request to transition the escrow into the `disputed` state.
- **Arbiter Resolution Panel:** For bounties in `disputed` status, authorized arbiters see a scoped dispute resolution panel displaying the dispute timestamp, rationale, contributor, and maintainer addresses. The arbiter can enter their public key, optional on-chain transaction hash, and execute either:
  - **Release to Contributor:** Releases escrowed funds to the contributor.
  - **Refund to Maintainer:** Refunds escrowed funds back to the creator.
  - Both actions call the backend API (`resolveDisputeBounty` / `POST /api/bounties/:id/resolve-dispute`) and contract endpoints, ensuring authenticated state transitions and on-chain auditability.

## Notifications & State Change Hooks

Stellar Bounty Board provides an opt-in notification system to notify maintainers and contributors across all bounty lifecycle transitions:

- `bounty_reserved`: Notifies the maintainer when a contributor reserves work.
- `bounty_submitted`: Notifies the maintainer when a solution PR is submitted.
- `bounty_released`: Notifies the contributor when their reward is released.
- `bounty_refunded`: Notifies parties when a bounty is refunded or canceled.
- `bounty_disputed`: Notifies parties when a dispute is opened or resolved.

### Delivery Channels

- **Webhook:** POSTs signed JSON payloads (`X-Bounty-Signature: sha256=...`) to `NOTIFICATION_WEBHOOK_URL`.
- **Email:** Delivers templated alerts via SendGrid when `SENDGRID_API_KEY` and `NOTIFICATION_CHANNEL=EMAIL` are configured.
- **Opt-In Preferences:** Users opt in or out via `POST /api/notifications/opt-in` and check status via `GET /api/notifications/opt-in/:address`.

## Deployment Guide

See [docs/deployment.md](docs/deployment.md) for step-by-step instructions to deploy the backend on Render and the frontend on Vercel, including required environment variables, health check paths, and troubleshooting tips.

For detailed architecture diagrams and data flow documentation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

For the persistence decision (JSON vs database) see the ADR: [docs/adr/0001-json-file-persistence.md](docs/adr/0001-json-file-persistence.md).

For integrating GitHub webhooks — including the HMAC-SHA256 algorithm, Node.js and Python verification examples, timing-safe comparison guidance, and troubleshooting — see [docs/webhook-signatures.md](docs/webhook-signatures.md).

## Contract Event Indexer Worker

The backend includes an isolated worker for indexing Soroban contract events. See [backend/worker/README.md](backend/worker/README.md) for details on running and extending the indexer.

## API Overview

Base URL:

- Local backend: `http://localhost:3001`
- Frontend proxy: `/api`

Routes:

- `GET /api/health` — liveness check
  - **Request**: No request body or query parameters required.
  - **Response 200 OK**:
    ```json
    {
      "service": "stellar-bounty-board-api",
      "status": "ok",
      "timestamp": "2026-09-27T15:30:00.000Z"
    }
    ```
  - **Error Responses**: Rate limit exceeded returns HTTP `429 Too Many Requests` (via global rate limiter).
- `GET /api/health/deep` — dependency-aware readiness check
  - **Request**: No request body or query parameters required.
  - **Response 200 OK** (all components healthy):
    ```json
    {
      "overall": "up",
      "components": {
        "store": "up",
        "soroban": "up",
        "contract": "up",
        "auth": "up"
      },
      "timestamp": "2026-09-28T01:00:00.000Z"
    }
    ```
  - **Response 503 Service Unavailable** (one or more components degraded):
    ```json
    {
      "overall": "down",
      "components": {
        "store": "down",
        "soroban": "up",
        "contract": "up",
        "auth": "up"
      },
      "timestamp": "2026-09-28T01:00:00.000Z"
    }
    ```
  - **Error Responses**:
    - `429 Too Many Requests` — rate limit exceeded.
  - Each component check times out after 5 seconds by default. Set
    `DEEP_HEALTH_CHECK_TIMEOUT_MS` to configure the per-component timeout in milliseconds;
    timed-out checks are reported as down.
- `GET /api/bounties` — list and filter bounties
  - **Query Parameters**:
    - `q` (optional): Free-text search keyword.
    - `contributor` (optional): Filter by contributor Stellar public key.
    - `maintainer` (optional): Filter by maintainer Stellar public key.
    - `status` (optional): Filter by status (`open`, `reserved`, `submitted`, `released`, `refunded`, `disputed`).
    - `tokenSymbol` (optional): Filter by token symbol (e.g. `USDC`, `XLM`).
    - `sort` (optional): Sort field (`amount`, `deadline`, `createdAt`, `status`). Default: `createdAt`.
    - `order` (optional): Sort direction (`asc`, `desc`). Default: `desc`.
    - `page` (optional): Page number (min: 1). Default: 1.
    - `pageSize` (optional): Items per page (1-100). Default: 20.
    - `deadlineBefore` / `deadlineAfter` (optional): ISO 8601 date strings.
  - **Response 200 OK**:
    ```json
    {
      "data": [
        {
          "id": 1,
          "title": "Build integration tests",
          "amount": "1000000000",
          "token": "C...",
          "status": "open",
          "maintainer": "G...",
          "contributor": null,
          "deadline": 1750000000,
          "createdAt": 1740000000
        }
      ],
      "total": 1,
      "page": 1,
      "pageSize": 20,
      "hasMore": false
    }
    ```
  - **Error Responses**:
    - `400 Bad Request` — invalid query parameters, invalid date strings, or invalid Stellar public keys.
    - `304 Not Modified` — returned when `If-None-Match` header matches resource ETag.
    - `429 Too Many Requests` — rate limit exceeded.
- `POST /api/bounties` — create and fund a new bounty
  - **Request Body**:
    ```json
    {
      "repo": "owner/repo",
      "issueNumber": 42,
      "title": "Fix login redirect bug",
      "description": "Detailed task description",
      "amount": "1000000000",
      "token": "C...",
      "deadline": 1750000000,
      "maintainer": "G...",
      "template": "standard"
    }
    ```
  - **Response 201 Created**:
    ```json
    {
      "data": {
        "id": 1,
        "title": "Fix login redirect bug",
        "description": "Detailed task description",
        "amount": "1000000000",
        "token": "C...",
        "status": "open",
        "maintainer": "G...",
        "contributor": null,
        "deadline": 1750000000,
        "createdAt": 1740000000
      }
    }
    ```
  - **Error Responses**:
    - `400 Bad Request` — invalid request payload (`INVALID_BODY`) or invalid amount.
    - `401 Unauthorized` — missing or invalid Stellar signature authorization header.
    - `429 Too Many Requests` — rate limit exceeded.
- `POST /api/bounties/:id/reserve` — reserve an open bounty
  - The `id` path parameter must be non-empty; no query parameters are accepted.
    `expectedVersion`, when provided, must be a positive integer. Invalid path,
    query, or body input returns `400` with code `BOUNTY_RESERVE_INVALID_INPUT`.
  - **Request Body**:
    ```json
    {
      "contributor": "G...",
      "expectedVersion": 1
    }
    ```
  - **Response 200 OK**:
    ```json
    {
      "data": {
        "id": 1,
        "status": "reserved",
        "contributor": "G...",
        "reservedAt": "2026-09-27T16:00:00.000Z",
        "version": 2
      }
    }
    ```
  - **Error Responses**:
    - `400 Bad Request` — invalid path, query, or request body (`BOUNTY_RESERVE_INVALID_INPUT`).
    - `404 Not Found` — bounty ID not found (`BOUNTY_NOT_FOUND`).
    - `409 Conflict` — bounty is already reserved/released, or version mismatch.
    - `429 Too Many Requests` — rate limit exceeded.
- `POST /api/bounties/:id/submit` — submit work for a reserved bounty
  - **Request Body**:
    ```json
    {
      "contributor": "G...",
      "submissionUrl": "https://github.com/owner/repo/pull/123",
      "notes": "Optional notes on implementation"
    }
    ```
  - **Response 200 OK**:
    ```json
    {
      "data": {
        "id": 1,
        "status": "submitted",
        "contributor": "G...",
        "submissionUrl": "https://github.com/owner/repo/pull/123",
        "notes": "Optional notes on implementation"
      }
    }
    ```
  - **Error Responses**:
    - `400 Bad Request` — invalid request payload or validation failure (`INVALID_BODY`).
    - `404 Not Found` — bounty ID not found (`BOUNTY_NOT_FOUND`).
    - `409 Conflict` — bounty is not in reserved state or contributor mismatch.
    - `429 Too Many Requests` — rate limit exceeded.
- `POST /api/bounties/:id/release` — release escrowed payout to contributor
  - **Request Body**:
    ```json
    {
      "maintainer": "G...",
      "transactionHash": "0000000000000000000000000000000000000000000000000000000000000000"
    }
    ```
  - **Response 200 OK**:
    ```json
    {
      "data": {
        "id": 1,
        "status": "released",
        "maintainer": "G...",
        "releasedAt": "2026-09-27T15:35:00.000Z"
      }
    }
    ```
  - **Error Responses**:
    - `400 Bad Request` — invalid request payload (`INVALID_BODY`).
    - `401 Unauthorized` — missing or invalid Stellar signature headers.
    - `404 Not Found` — bounty ID not found (`BOUNTY_NOT_FOUND`).
    - `409 Conflict` — bounty is not in submitted state or maintainer mismatch.
    - `429 Too Many Requests` — rate limit exceeded.
- `POST /api/bounties/:id/refund` — refund a bounty; see the [request and response contract](#refund-request-and-responses) below.
- `GET /api/open-issues` — fetch available candidate GitHub issues for bounties
  - **Request**: No request body or query parameters required.
  - **Response 200 OK**: Cached for 10 minutes (`Cache-Control: max-age=600`).
    ```json
    {
      "data": [
        {
          "id": "GH-42",
          "title": "Fix login redirect bug",
          "labels": ["bug", "good first issue"],
          "summary": "First paragraph summary of the GitHub issue body.",
          "impact": "starter"
        }
      ]
    }
    ```
  - **Error Responses**:
    - `502 Bad Gateway` — upstream GitHub API unreachable or returned failure.
    - `429 Too Many Requests` — rate limit exceeded.

### Refund request and responses

`POST /api/bounties/:id/refund` returns the updated bounty record, not an on-chain transaction receipt. The current handler updates the JSON store; an optional transaction hash is recorded, not submitted or verified on-chain.

#### Request

Send a JSON object with `Content-Type: application/json`. The `:id` path parameter is a non-empty string after trimming; the handler does not enforce the `BNT-0001` format. No query parameters are used.

| Body field        | Type   | Required            | Meaning                                                                                                                                                                                                                                |
| ----------------- | ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maintainer`      | string | Yes                 | Valid Stellar `G...` public key (56 characters, checksum checked), matching the signer and the bounty's maintainer. The schema trims it, but authentication compares the original value first; send it without surrounding whitespace. |
| `transactionHash` | string | No                  | Exactly 64 hexadecimal characters after trimming. Saved as `refundedTxHash`; omitting it preserves an existing value, if any.                                                                                                          |
| `action`          | string | With authentication | Send `"refund"`. The current authentication middleware checks only that this is a non-empty string, not that it equals the route's action.                                                                                             |
| `bountyId`        | string | With authentication | Must exactly equal the decoded `:id` path parameter before the handler trims it.                                                                                                                                                       |
| `timestamp`       | number | With authentication | Unix time in seconds, within 60 seconds of the server's current time in either direction.                                                                                                                                              |

Authentication also requires:

- `X-Stellar-Public-Key`: the signing public key, present in the server's `MAINTAINER_PUBLIC_KEYS` list (or `MAINTAINER_PUBLIC_KEY` fallback) and matching the stored bounty maintainer.
- `X-Stellar-Signature`: a signature over the exact JSON request-body bytes, including the authentication fields. Hex or base64 is accepted, optionally prefixed with `0x`, `sig=` or `signature=`. Do not reserialize the body after signing. A verified signature cannot be reused within 60 seconds, even if a later check rejects the request.
- Optional `Idempotency-Key`: a unique key for this operation; see the replay behavior below.

Authentication runs before body validation. It is skipped only when `NODE_ENV=test` and `STELLAR_AUTH_ENFORCED` is not `"true"`; the `maintainer`/`transactionHash` schema still applies. After authentication, validation strips `action`, `bountyId`, `timestamp` and other unknown fields before calling the store.

#### Response 200 OK

For a newly executed refund, the JSON body is `{ "data": RefundedBounty }`. The following is a type description, not a sample bounty:

```ts
type RefundedBounty = {
  id: string;
  repo: string;
  issueNumber: number;
  title: string;
  summary: string;
  maintainer: string;
  tokenSymbol: string;
  tokenAddress: string;
  amount: number;
  labels: string[];
  status: 'refunded';
  createdAt: number;
  deadlineAt: number;
  refundedAt: number;
  version: number;
  events: Array<{
    type:
      | 'created'
      | 'open'
      | 'reserved'
      | 'submitted'
      | 'released'
      | 'refunded'
      | 'expired'
      | 'disputed'
      | 'notes_updated'
      | 'deadline_extended'
      | 'archived'
      | 'pr_merged';
    timestamp: number;
    actor?: string;
    details?: Record<string, unknown>;
  }>;
  contributor?: string;
  reservedAt?: number;
  submittedAt?: number;
  releasedAt?: number;
  releasedTxHash?: string;
  protocolFeeCollected?: number;
  refundedTxHash?: string;
  canceledAt?: number;
  canceledTxHash?: string;
  submissionUrl?: string;
  notes?: string;
  disputedAt?: number;
  disputeReason?: string;
  lastDisputeAlertAt?: number;
  prMerged?: boolean;
  prMergedAt?: number;
  reservationTimeoutSeconds?: number;
  archived?: boolean;
  archivedAt?: number;
};
```

All timestamp fields above are Unix seconds, not ISO strings. Optional fields are omitted when undefined, not returned as `null`. The store preserves existing fields, sets `status` and `refundedAt`, increments `version` by one, and appends `{ type: "refunded", timestamp: refundedAt, actor: maintainer }` to `events`. The current store accepts `open`, `reserved`, `expired` and `disputed` bounties; it rejects `submitted`, `released` and `refunded` bounties. It does not require the deadline to have passed.

#### Error responses

The table covers the refund handler and its mounted middleware on a cache miss. `requestId` is a string when request context has run; earlier parser failures omit it. An `X-Request-ID` response header is set when that context runs. Error bodies are not all the same shape.

| HTTP status                  | JSON body shape                                                                                                      | Condition                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 Bad Request`            | `{ "error": "Invalid JSON" }`                                                                                        | Malformed JSON rejected by the global parser.                                                                                                                                                                                                                                                                         |
| `400 Bad Request`            | `{ "error": "Validation failed", "details": ZodIssue[] }`                                                            | Invalid body, missing/invalid `maintainer`, or invalid `transactionHash`; details are described below.                                                                                                                                                                                                                |
| `400 Bad Request`            | `{ "error": string, "requestId": string }`                                                                           | Invalid trimmed path ID or a store/domain error. Exact domain messages are listed below. A path-validation error is the stringified Zod error, not a `details` array.                                                                                                                                                 |
| `400 Bad Request`            | `{ "error": string, "requestId"?: string }`                                                                          | Other exposed parser errors, such as a mismatched content length. A disconnected client may not receive a response.                                                                                                                                                                                                   |
| `401 Unauthorized`           | `{ "error": string }`                                                                                                | Authentication failed; exact messages are listed below.                                                                                                                                                                                                                                                               |
| `403 Forbidden`              | `{ "error": "Signer public key does not match stored bounty maintainer." }`                                          | The authenticated signer is not the stored bounty maintainer.                                                                                                                                                                                                                                                         |
| `413 Payload Too Large`      | `{ "error": "Payload too large", "maxBytes": number }`                                                               | Route `Content-Length` limit exceeded (`DEFAULT_BODY_LIMIT`, default `32kb` / `32768` bytes), or the global JSON parser limit exceeded (`RAW_BODY_LIMIT`, default `256kb`). The global parser error handler reports `maxBytes: 32768` regardless of its configured parser limit.                                      |
| `415 Unsupported Media Type` | `{ "error": string }`                                                                                                | The JSON parser rejects an unsupported charset or content encoding, with a message such as `unsupported charset "ISO-8859-1"` or `unsupported content encoding "br"`. This route does **not** mount `requireJsonContentType`; a missing/non-JSON content type does not itself produce that middleware's 415 response. |
| `429 Too Many Requests`      | `{ "error": "Too many mutations, please slow down." }` or `{ "error": "Too many read requests, please slow down." }` | Per-IP rate limiting in `app.ts`; both the global mutation limiter and the unconditionally mounted read limiter can reject this POST. The mutation limiter is also mounted on the route. Rate-limit responses include `Retry-After`.                                                                                  |
| `500 Internal Server Error`  | `{ "error": "Server maintainer public key configuration is missing." }`                                              | Authentication is enabled but no maintainer key is configured.                                                                                                                                                                                                                                                        |
| `500 Internal Server Error`  | `{ "error": "Failed to access persistent data store.", "requestId": string }`                                        | JSON bounty-store or audit-store read/write failure.                                                                                                                                                                                                                                                                  |
| `500 Internal Server Error`  | `{ "error": "Internal server error.", "requestId"?: string }`                                                        | Unexpected middleware failure, or a handler failure whose message would expose internal dependency details.                                                                                                                                                                                                           |
| `503 Service Unavailable`    | `{ "error": "Data store lock could not be acquired.", "requestId": string }`                                         | Store file-lock acquisition failed.                                                                                                                                                                                                                                                                                   |

The refund handler returns these domain errors as **400**, not 404 or 409:

- `Bounty not found.`
- `Maintainer address does not match this bounty.`
- `This bounty is already finalized.`
- `Submitted bounties must be reviewed before refund.`

The authentication middleware returns these **401** messages:

- `Missing x-stellar-signature header.`
- `Missing x-stellar-public-key header.`
- `Unauthorized Stellar public key.`
- `Invalid or missing action in request body.`
- `Invalid or missing bountyId in request body.`
- `Request bountyId does not match the request path.`
- `Invalid or missing timestamp in request body.`
- `Signature timestamp has expired or is invalid.`
- `Replay attack detected: signature already processed.`
- `Invalid Stellar signature.`
- `Request maintainer does not match signer public key.`

**Error codes:** There is no top-level `code`/`errorCode` field and no refund-specific machine codes such as `BOUNTY_NOT_FOUND` or `INVALID_BODY`. Body-validation `details` entries have `path: (string | number)[]`, `message: string` and Zod's `code`. For this request schema, those codes are `invalid_type` (with `expected` and `received`), `custom` (invalid Stellar public key), and `invalid_string` (with `validation: "regex"`, for a transaction hash). The path is `[]` for the whole body, `["maintainer"]` or `["transactionHash"]` for a field. Key/hash messages are respectively `Must be a valid Stellar public key (G... format, 56 characters with valid checksum).` and `Transaction hash must be a 64 character hex string.`

#### Retries and idempotency

`Idempotency-Key` is optional and trimmed; blank keys are ignored. For the configured `IDEMPOTENCY_TTL_MS` (default 10 minutes), a completed cached JSON response is replayed with its original status and body, including error responses. A hit bypasses authentication, validation and the refund handler, but not earlier parsing, rate limits or the body-size check.

Keys are global within one process, not scoped to the route, bounty or caller. Reusing a key from another operation can return that operation's status/body instead of the refund contract above: for example, a cached release can return `200` with `data.status: "released"` and no `refundedAt`. Use a distinct key for each operation. The cache is lost on restart, is not shared across replicas, and does not coalesce concurrent requests before a response is stored.

A failed response does not always mean the bounty was unchanged: the refund is persisted before the audit write. After a store/server error or an uncertain response, inspect the bounty's current state before attempting another refund. If a corrected request is needed after a cached error, use a new idempotency key and a fresh signature rather than replaying the rejected request.

Sources of truth: the [route and error handlers](backend/src/app.ts), [request schema](backend/src/validation/schemas.ts), [store record and refund implementation](backend/src/services/bountyStore.ts), [authentication](backend/src/middleware/auth.ts), [idempotency](backend/src/middleware/idempotency.ts), and [terminal error handler](backend/src/middleware/errors.ts).

## Run Locally

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
```

Open:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`

Build:

```bash
npm run build
```

## Testing

Backend tests cover the JSON-backed bounty lifecycle (create, reserve, submit, release, refund, expiration) and the main HTTP routes. They use a temporary store file via `BOUNTY_STORE_PATH` and disable strict rate limiting when `NODE_ENV=test`.

From the repository root (after `npm run install:all`):

```bash
npm test
```

Watch mode during development:

```bash
npm run test:watch
```

Coverage report (Istanbul via Vitest):

```bash
npm run test:coverage
```

### Load Testing

The load-test script uses [autocannon](https://github.com/mcollina/autocannon) to run a mixed read/write workload against the backend. It seeds 20 bounties and opens 20 concurrent connections for 30 seconds.

Start the backend first, then run:

```bash
npm run load:test
```

Configurable via CLI flags:

| Flag            | Default                 | Description                      |
| --------------- | ----------------------- | -------------------------------- |
| `--connections` | `20`                    | Number of concurrent connections |
| `--duration`    | `30`                    | Duration in seconds              |
| `--bounties`    | `20`                    | Number of seed bounties          |
| `--url`         | `http://localhost:3001` | Backend base URL                 |

Example with custom options:

```bash
npm run load:test -- --connections 50 --duration 60 --bounties 40
```

Workload distribution: **70 %** `GET /api/bounties` · **20 %** `GET /api/bounties/:id` · **10 %** `POST /api/bounties/:id/reserve`.

Results include p50/p99/max latency, requests/s, bytes/s, error count, and error rate.

## Contract Notes

The Soroban contract models the escrow lifecycle:

- `create_bounty`
- `reserve_bounty`
- `submit_bounty`
- `release_bounty`
- `refund_bounty`
- `get_bounty`

The backend currently acts as the demo control plane, while the contract gives you a clear path to move the source of truth on-chain.

### TypeScript Bindings

The frontend consumes auto-generated TypeScript bindings from the Soroban contract ABI. The generated types live in `frontend/src/generated/` and are imported by `frontend/src/api.ts` to keep frontend and contract types in sync.

#### Regenerating bindings after contract changes

Whenever the contract ABI changes, regenerate the bindings before committing:

```bash
npm run gen:bindings
```

This script:

1. Builds the contract WASM (`cargo build --release --target wasm32-unknown-unknown`).
2. Runs `stellar contract bindings typescript` against the WASM.
3. Writes the generated TypeScript package to `frontend/src/generated/`.

The Stellar CLI is downloaded automatically if it is not already installed.

#### Catching ABI drift in CI

The `bindings-drift.yml` workflow regenerates bindings on every PR and push to `main` and fails if the committed files differ from the freshly generated output. If CI reports drift, run `npm run gen:bindings` locally and commit the updated files.

### Contract Error Codes

`contracts/src/lib.rs` exports `ContractError`, a `#[contracterror]` enum with
explicit `u32` discriminants. `panic_with_error!` emits `Error(Contract, #N)`;
clients should decode the number rather than match panic text. Codes **1-3**
retain the original README allocation. Other codes are explicit and append-only:
never renumber, recycle or infer a code from enum declaration order.

This replaces the previous string-panic implementation (which already had 37
variant names, despite the old three-row README table). It changes error wire
representation; consumers matching the old Debug strings must migrate. Entry
point arguments, stored bounty layout, eligibility, authorization, fee arithmetic
and successful transfer/event payloads are unchanged.

| Code | Variant                         | Meaning                                                                                  |
| ---- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| 1    | `BountyNotOpen`                 | Reservation/cancellation requires an open bounty; other non-open states are rejected.    |
| 2    | `BountyNotFound`                | The requested bounty ID does not exist.                                                  |
| 3    | `BountyAlreadyReserved`         | Reservation found an already-reserved, unexpired bounty (same or different contributor). |
| 4    | `AlreadyInitialized`            | Reserved initialized-state error.                                                        |
| 5    | `NotInitialized`                | Reserved missing-initialization error.                                                   |
| 6    | `NotAdmin`                      | The supplied admin does not match the stored admin.                                      |
| 7    | `NotArbiter`                    | The supplied arbiter does not match the configured arbiter.                              |
| 8    | `ArbiterNotSet`                 | Required arbiter storage is missing.                                                     |
| 9    | `NoPendingArbiter`              | No arbiter rotation is pending.                                                          |
| 10   | `TimelockNotElapsed`            | Arbiter rotation timelock has not elapsed.                                               |
| 11   | `InvalidAmount`                 | Amount is non-positive or exceeds the supported maximum.                                 |
| 12   | `AmountTooSmall`                | Amount is below the configured minimum.                                                  |
| 13   | `DeadlineMustBeInTheFuture`     | Creation deadline is at or before the ledger timestamp.                                  |
| 14   | `DeadlineMustAdvance`           | Replacement deadline does not advance the existing deadline.                             |
| 15   | `FeeRecipientNotSet`            | A nonzero protocol fee requires a configured recipient.                                  |
| 16   | `TokenNotAllowed`               | Allowlist is enabled and excludes the escrow token.                                      |
| 17   | `DisputeWindowOverrideTooSmall` | Override is below the allowed minimum.                                                   |
| 18   | `DisputeWindowOverrideTooLarge` | Override exceeds the allowed maximum.                                                    |
| 19   | `BountyMustBeReserved`          | Submission/reassignment requires a reserved bounty.                                      |
| 20   | `BountyMustBeSubmitted`         | Release/dispute requires a submitted bounty.                                             |
| 21   | `BountyNotExpiredYet`           | Refund is attempted at or before a nonzero deadline.                                     |
| 22   | `BountyExpired`                 | Reservation/submission/dispute found an expired bounty.                                  |
| 23   | `BountyAlreadyFinalized`        | Refund found a released/refunded bounty.                                                 |
| 24   | `CannotExtendFinalizedBounty`   | A terminal bounty cannot have its deadline extended.                                     |
| 25   | `MaintainerMismatch`            | The authenticated maintainer argument is not the bounty maintainer.                      |
| 26   | `ContributorMismatch`           | The authenticated contributor argument is not the assigned contributor.                  |
| 27   | `MissingContributor`            | Required contributor storage is absent (including malformed reserved/submitted records). |
| 28   | `DisputeWindowNotMet`           | The dispute settlement window has not elapsed.                                           |
| 29   | `ContractIsPaused`              | The circuit breaker blocks creation/reservation.                                         |
| 30   | `InsufficientArbiterStake`      | Arbiter bond is below the configured minimum.                                            |
| 31   | `StakeTokenMismatch`            | Bond uses a different token.                                                             |
| 32   | `NoArbiterStake`                | No recorded bond exists.                                                                 |
| 33   | `SlashExceedsStake`             | Requested slash exceeds the bond.                                                        |
| 34   | `NotCommitteeMember`            | Caller is not a committee member.                                                        |
| 35   | `DuplicateCommitteeVote`        | Member has already voted on this dispute.                                                |
| 36   | `CommitteeSizeExceeded`         | Committee exceeds its size limit.                                                        |
| 37   | `DuplicateCommitteeMember`      | Committee contains duplicate addresses.                                                  |
| 38   | `CommitteeNotConfigured`        | No committee is configured.                                                              |
| 39   | `InvalidFeeBps`                 | Creation fee exceeds 10,000 basis points.                                                |
| 40   | `BountyIdOverflow`              | The next bounty ID cannot be allocated without u64 overflow.                             |
| 41   | `BountyMustBeDisputed`          | Resolution/voting requires a disputed bounty.                                            |
| 42   | `EscrowTransferFailed`          | The token rejected creation funding or returned an invalid result.                       |
| 43   | `PayoutTransferFailed`          | The token rejected the release net payout or returned an invalid result.                 |
| 44   | `FeeTransferFailed`             | The token rejected the release fee transfer or returned an invalid result.               |
| 45   | `RefundTransferFailed`          | The token rejected the refund or returned an invalid result.                             |

`AlreadyInitialized` and `NotInitialized` retain named allocations but are not
currently emitted by lifecycle entry points. Raw administrative/configuration
panics outside the lifecycle audit are not promised to use this envelope.

#### Lifecycle failure audit

The table follows the real source, including guard order; it does not add new
eligibility restrictions. `resolve_dispute` is listed alongside dispute creation
because it is the settlement path. Error variants shared by the same failure
condition keep the same code across entry points.

| Function          | Contract-owned failures, in evaluation order                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_bounty`   | `ContractIsPaused`; `InvalidAmount`; `AmountTooSmall`; `DeadlineMustBeInTheFuture`; `InvalidFeeBps`; `FeeRecipientNotSet`; `TokenNotAllowed`; `DisputeWindowOverrideTooSmall` / `DisputeWindowOverrideTooLarge`; `EscrowTransferFailed`; `BountyIdOverflow` |
| `reserve_bounty`  | `ContractIsPaused`; `BountyNotFound`; `BountyExpired`; `BountyAlreadyReserved`; `BountyNotOpen`                                                                                                                                                             |
| `submit_bounty`   | `BountyNotFound`; `BountyExpired`; `BountyMustBeReserved`; `MissingContributor`; `ContributorMismatch`                                                                                                                                                      |
| `release_bounty`  | `BountyNotFound`; `MaintainerMismatch`; `BountyMustBeSubmitted`; `MissingContributor`; `PayoutTransferFailed`; `FeeRecipientNotSet`; `FeeTransferFailed`                                                                                                    |
| `refund_bounty`   | `BountyNotFound`; `MaintainerMismatch`; `BountyAlreadyFinalized`; `BountyNotExpiredYet`; `RefundTransferFailed`                                                                                                                                             |
| `dispute_bounty`  | `BountyNotFound`; `BountyExpired`; `MissingContributor`; `BountyMustBeSubmitted`; `ArbiterNotSet`; `NotArbiter`                                                                                                                                             |
| `resolve_dispute` | `ArbiterNotSet`; `BountyNotFound`; `BountyMustBeDisputed`; `DisputeWindowNotMet`; release additionally requires contributor/fee recipient storage. This older settlement path retains nested token errors.                                                  |

**Authorization is separate.** `require_auth()` is still enforced by Soroban:
create/release/refund require the maintainer; reserve/submit require the
contributor; dispute requires the **stored contributor**, with the arbiter
argument checked against configuration; resolution requires the stored arbiter.
An absent/invalid signature remains a host authorization failure, not a contract
validation code. An authenticated but incorrect maintainer/contributor argument
produces `MaintainerMismatch` / `ContributorMismatch`. Passing the configured
arbiter to `dispute_bounty` does not grant that address permission to sign for
the contributor. No authentication check was removed or replaced.

The six lifecycle entry points map token invocation failures to operation-specific
codes 42-45 so a nested token's numeric error cannot be confused with one of
this contract's validation codes. The host's diagnostic invocation trace retains
the underlying token failure. Root invocation rollback preserves escrow balances,
IDs and bounty state, including when a net payout succeeds before a fee fails.
Host resource limits, invalid ABI arguments and malformed storage decoding remain
host failures; they are not fabricated business-error variants.

The existing frontend `ContractError` enum and `CONTRACT_ERROR_LABELS` are generated
from this declaration by `node scripts/generate-contract-errors.mjs`. Use
`node scripts/generate-contract-errors.mjs --check` to detect drift without writing
files; the root script tests run the same check. The generator updates only the
error sections of the existing bindings, preserving unrelated ABI types.

Verification: `cargo test --locked --test lifecycle_errors` checks exact SDK
errors/enum conversion, all lifecycle guards, real Stellar asset transfer
rejection/rollback and missing signatures. Existing lifecycle, role, fuzz and
arbiter tests use the numeric wire envelope as well.
With the pinned SDK 27 and modern Rust, build the contract with
`rustup target add wasm32v1-none` and
`cargo build --locked --release --target wasm32v1-none`. SDK 27 rejects the
older `wasm32-unknown-unknown` target used by the current CI setup; that target
failure also occurs on the unchanged baseline.

## FAQ

For common issues, troubleshooting steps, wallet setup, testnet funding, transaction errors, and bounty workflow explanations, see:

- [FAQ Guide](./docs/FAQ.md)

## Maintainers

Interested in helping maintain the project? See [docs/MAINTAINERS.md](docs/MAINTAINERS.md) for the roles, expectations, and how to get involved.

## Contribution Hooks

Contribution-ready issue drafts live in `docs/issues`.

See the wave backlog documents for organized issue sets:

- [Wave 4](docs/wave-4.md) — 60 issues across frontend, backend, contracts, docs, and DevOps
- [Wave 5](docs/wave-5.md) — 40 issues focusing on security, observability, and polish
- [Wave 6](docs/wave-6.md) — 7 issues for production readiness: database migration, wallet auth, and GitHub integration

Suggested first issues:

- Wallet-authenticated maintainer actions
- GitHub webhook sync for PR state
- Event indexer for contract payouts
- Postgres persistence and audit log support
