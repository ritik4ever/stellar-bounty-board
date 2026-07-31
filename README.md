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

- `GET /api/health`
- `GET /api/health/deep` — dependency-aware readiness check (returns 503 if any component is down)
- `GET /api/bounties`
- `POST /api/bounties`
- `POST /api/bounties/:id/reserve`
- `POST /api/bounties/:id/submit`
- `POST /api/bounties/:id/release`
- `POST /api/bounties/:id/refund`
- `GET /api/open-issues`

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
