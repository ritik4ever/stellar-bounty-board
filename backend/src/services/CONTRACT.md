# Services Layer Contract

## Overview

The `backend/src/services/` directory contains business logic services that sit
between the Express routes (`backend/src/routes/`) and the data stores
(`backend/src/store.ts`, `backend/src/validation/`).

## Service Conventions

### Naming
- Each file exports a single service module (e.g. `bountyStore.ts` → bounty storage)
- Files are named after the domain they serve (bounty, reservation, submission)

### Interface
- Services expose async functions (return Promises)
- Services do NOT call `res.json()` or `res.status()` — that's the route's job
- Services throw on errors; routes catch and translate to HTTP responses

### Dependencies
- Services may import from `../store.ts`, `../config.ts`, `../logger.ts`
- Services MUST NOT import from `../routes/` or `../app.ts` (no circular deps)
- Services MUST NOT access `process.env` directly — use `../config.ts` instead

### Testing
- Each service has a corresponding test file in `backend/test/`
- Tests use the vitest framework
- Mock the store layer in tests, not the service itself

## Files

| Service | File | Purpose |
|---------|------|---------|
| Bounty Store | `bountyStore.ts` | CRUD for bounty records, cache invalidation |
| Reservation Expiration | `reservationExpirationJob.ts` | Background job for auto-expiring reservations |
| Dispute Alert | `disputeAlertJob.ts` | Background job for dispute SLA monitoring |
| Recurring Bounty Scheduler | `recurringBountySchedules.ts` | Background job for recurring bounty cycles |

<!-- Documented: 2026-10-01 — per issue #1300 -->
