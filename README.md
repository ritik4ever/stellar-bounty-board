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

| Role | Description |
|---|---|
| **Maintainer** | Creates and funds the bounty escrow. |
| **Contributor** | Reserves the bounty and submits a pull request for review. |
| **Arbiter** | A trusted third-party address that resolves disputes. Configured once at contract initialisation. |

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

If any component is `"down"`, the endpoint returns HTTP 503. Set `MAINTAINER_PUBLIC_KEY`, `ARBITER_ADDRESS`, and `SOROBAN_CONTRACT_ID` in your environment, and ensure the Soroban RPC URL is reachable.

### Rate limiting

The backend applies three independent per-IP limits, all within `RATE_LIMIT_WINDOW_MS` (default 60000):

| Tier | Applies to | Variable | Default |
|---|---|---|---|
| Read | all `GET` routes except health probes | `RATE_LIMIT_READ_MAX` | 120 |
| Mutation | state-changing routes (create, reserve, submit, release, refund, …) | `RATE_LIMIT_MUTATION_MAX` | 10 |
| Webhook | `POST /api/webhooks/github` only | `RATE_LIMIT_WEBHOOK_MAX` | 300 |

The webhook route has its own, larger ceiling because GitHub is its legitimate caller: a single busy repository can deliver a burst of `pull_request` events around a merge, and dropping those deliveries means manual redelivery. Signature verification runs **before** the webhook limit, so unsigned or tampered requests are rejected with 401 and never spend the quota a real delivery needs. Limits are keyed by `req.ip`; behind a reverse proxy that rewrites the peer address, the webhook ceiling becomes global rather than per-source, so keep `RATE_LIMIT_WEBHOOK_MAX` generous there. Rationale and tuning notes live in `backend/src/utils.ts`.

**Disabling rate limiting is a two-signal decision.** Limiters are switched off only when `NODE_ENV=test` **and** `RATE_LIMIT_TEST_BYPASS=true` are both set. `NODE_ENV=test` alone leaves them enabled, and setting the bypass flag outside a test run makes the backend **refuse to start** — a stray test variable in a real environment fails loudly instead of silently serving unprotected. See `backend/src/middleware/rateLimitGuard.ts`.

### Dispute lifecycle

1. **Maintainer raises a dispute** — after the work is submitted, the maintainer can open a dispute within the on-chain dispute window.
2. **Arbiter reviews** — the arbiter examines the submitted work off-chain (PR, deliverables, communication).
3. **Arbiter resolves on-chain** — the arbiter calls `dispute_bounty` on the Soroban contract with the bounty ID and their address. The contract verifies the caller matches the stored `ARBITER_ADDRESS`.
4. **Funds are released** — the contract releases the escrowed tokens to either the contributor (work accepted) or the maintainer (work rejected / refund).

The arbiter address is immutable after `initialize` is called on the contract — rotate it only by redeploying the contract.

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
    - `400 Bad Request` — invalid request payload (`INVALID_BODY`).
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
- `POST /api/bounties/:id/refund`
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

Backend tests cover the JSON-backed bounty lifecycle (create, reserve, submit, release, refund, expiration) and the main HTTP routes. They use a temporary store file via `BOUNTY_STORE_PATH`, and disable rate limiting through the explicit test opt-in: `NODE_ENV=test` plus `RATE_LIMIT_TEST_BYPASS=true` (set for the suite in `backend/vitest.config.ts`). `NODE_ENV=test` on its own no longer disables any limiter.

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

| Flag            | Default | Description                        |
|-----------------|---------|------------------------------------|
| `--connections` | `20`    | Number of concurrent connections   |
| `--duration`    | `30`    | Duration in seconds                |
| `--bounties`    | `20`    | Number of seed bounties            |
| `--url`         | `http://localhost:3001` | Backend base URL    |

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

The Soroban contract uses a named error enum (`Error`) for recoverable failures:

| Code | Variant            | Description                                            |
|------|--------------------|--------------------------------------------------------|
| 1    | `BountyNotOpen`    | Bounty reservation failed because the bounty is not in `Open` status (already reserved, expired, etc.) |
| 2    | `BountyNotFound`   | The specified bounty ID does not exist                 |
| 3    | `BountyAlreadyReserved` | The bounty is already reserved by another contributor |

These errors are invoked via `panic_with_error!` and surface as `Error(Contract, #N)` in test expectations.

## FAQ

For common issues, troubleshooting steps, wallet setup, testnet funding, transaction errors, and bounty workflow explanations, see:

* [FAQ Guide](./docs/FAQ.md)

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
