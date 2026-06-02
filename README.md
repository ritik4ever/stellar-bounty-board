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

## Deployment Guide

See [docs/deployment.md](docs/deployment.md) for step-by-step instructions to deploy the backend on Render and the frontend on Vercel, including required environment variables, health check paths, and troubleshooting tips.

For detailed architecture diagrams and data flow documentation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

For integrating GitHub webhooks — including the HMAC-SHA256 algorithm, Node.js and Python verification examples, timing-safe comparison guidance, and troubleshooting — see [docs/webhook-signatures.md](docs/webhook-signatures.md).

## Contract Event Indexer Worker

The backend includes an isolated worker for indexing Soroban contract events. See [backend/worker/README.md](backend/worker/README.md) for details on running and extending the indexer.

## API Overview

Base URL:

- Local backend: `http://localhost:3001`
- Frontend proxy: `/api`

Routes:

- `GET /api/health`
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

### Contract Error Codes

The Soroban contract uses a named error enum (`Error`) for recoverable failures:

| Code | Variant            | Description                                            |
|------|--------------------|--------------------------------------------------------|
| 1    | `BountyNotOpen`    | Bounty reservation failed because the bounty is not in `Open` status (already reserved, expired, etc.) |
| 2    | `BountyNotFound`   | The specified bounty ID does not exist                 |
| 3    | `BountyAlreadyReserved` | The bounty is already reserved by another contributor |

These errors are invoked via `panic_with_error!` and surface as `Error(Contract, #N)` in test expectations.

## Contribution Hooks

Contribution-ready issue drafts live in `docs/issues`.

Suggested first issues:

- Wallet-authenticated maintainer actions
- GitHub webhook sync for PR state
- Event indexer for contract payouts
- Postgres persistence and audit log support
