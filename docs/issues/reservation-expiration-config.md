# Document the reservationExpirationJob Configuration Options

Labels: `documentation`, `backend`, `good first issue`

## Summary

The `reservationExpirationJob` service controls how long a contributor can hold a bounty reservation before it automatically returns to `open`. Its behaviour is fully configurable via environment variables, but this is not yet documented in `ONBOARDING.md`, `.env.example`, or any dedicated reference page.

## Why It Matters

- Contributors and maintainers need to know the default TTL so they can plan their work windows.
- Operators deploying to Railway, Render, or Docker need to know which env vars to set.
- Without docs, operators silently inherit the 7-day default and may not realise reservations are expiring.

## Background

`backend/src/services/reservationExpirationJob.ts` reads three environment variables at startup:

| Variable                      | Default                                          | Description                                                                                   |
| ----------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `RESERVATION_TTL_DAYS`        | `7`                                              | Days before a held reservation is expired back to `open`. Must be a positive finite number.   |
| `EXPIRATION_CRON_INTERVAL_MS` | `3600000` (1 hour)                               | Polling interval in milliseconds. Controls how often the job scans for stale reservations.    |
| `BOUNTY_STORE_PATH`           | `../../data/bounties.json` (relative to `dist/`) | Absolute or relative path to the JSON bounty store. Useful when mounting a persistent volume. |

Invalid values (non-numeric, zero, negative) fall back to the defaults and emit a `warn`-level Pino log entry.

The job runs **immediately on startup** and then on every `EXPIRATION_CRON_INTERVAL_MS` tick. It is stopped cleanly during graceful shutdown via `stopExpirationJob()`.

## Acceptance Criteria

- [ ] `.env.example` at the repo root includes all three variables with their defaults and a one-line comment each.
- [ ] `ONBOARDING.md` has a new **"Reservation Expiration Job"** section explaining the TTL, polling interval, and store path variables.
- [ ] `backend/src/services/reservationExpirationJob.ts` JSDoc header is kept in sync with any wording changes.
- [ ] A short **"Configuration Reference"** table is added to `docs/ARCHITECTURE.md` under the Backend section.
- [ ] No code changes are required — this is a pure documentation task.

## Files to Edit

- `.env.example`
- `ONBOARDING.md`
- `docs/ARCHITECTURE.md`

## Getting Started

```bash
# Read the source first
cat backend/src/services/reservationExpirationJob.ts

# Then update the docs
code .env.example ONBOARDING.md docs/ARCHITECTURE.md
```

## Related

- Wave 4 issue #21 — Add bounty auto-expiration cron job (implementation, now merged)
- `backend/src/services/bountyStore.ts` — the store the job reads and patches
