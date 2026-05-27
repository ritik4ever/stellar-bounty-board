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

## Reservation Expiration

Reserved bounties can be returned to the open pool when the contributor does not submit work before the reservation timeout.

New bounties support an optional `reservationTimeoutSeconds` field. When omitted, the backend stores a default value of `604800` seconds, which is 7 days. This per-bounty value is used when bounty records are normalized during normal store reads.

The backend also includes a scheduled expiration job in `backend/src/services/reservationExpirationJob.ts`. When started, it:

- checks reserved bounties immediately and then on a timer
- returns stale reserved bounties to `open`
- clears `contributor` and `reservedAt`
- increments the bounty `version`
- appends an `expired` event with the reason `reservation_ttl_exceeded`

`reservationTimeoutSeconds` and `RESERVATION_TTL_DAYS` are evaluated separately. The per-bounty `reservationTimeoutSeconds` value is applied during bounty store normalization, while `RESERVATION_TTL_DAYS` controls the scheduled job in `backend/src/services/reservationExpirationJob.ts`. Keep them aligned when you want one consistent reservation window; if they differ, the shorter effective timeout can return the reservation to `open` first.

The scheduled job can be tuned with these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RESERVATION_TTL_DAYS` | `7` | Number of days a reservation may remain stale before the scheduled job expires it. Invalid or non-positive values fall back to 7 days. |
| `EXPIRATION_CRON_INTERVAL_MS` | `3600000` | How often the scheduled job checks for stale reservations, in milliseconds. Invalid or non-positive values fall back to 1 hour. |

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
