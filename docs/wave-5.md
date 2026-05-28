# Wave 5 — Contribution Backlog

This document tracks the **Wave 5** contribution issues for Stellar Bounty Board.
Wave 5 focuses on hardening the platform: security posture, operational documentation,
observability, and contributor-experience polish built on top of the Wave 4 foundation.

## Summary

| Area                              | Issues | Focus                                                       |
| --------------------------------- | ------ | ----------------------------------------------------------- |
| Frontend (`frontend/src/`)        | 8      | Accessibility, error boundaries, UX polish                  |
| Backend (`backend/src/`)          | 12     | Observability, job configuration, search, rate-limiting     |
| Smart Contract (`contracts/src/`) | 6      | Deadline enforcement, dispute flow, fuzz coverage           |
| Docs (`docs/`)                    | 10     | Config references, security timeline, architecture diagrams |
| DevOps / Config                   | 4      | Healthchecks, secrets scanning, release automation          |
| **Total**                         | **40** |                                                             |

---

## Frontend Issues (8)

| #   | Title                                                            | File                                |
| --- | ---------------------------------------------------------------- | ----------------------------------- |
| 1   | Add React error boundary around bounty list and detail views     | `frontend/src/App.tsx`              |
| 2   | Add ARIA labels and keyboard navigation to BountyCard            | `frontend/src/BountyCard.tsx`       |
| 3   | Add skeleton loading state while bounties are fetching           | `frontend/src/App.tsx`              |
| 4   | Add toast notification system for reserve/submit/release actions | `frontend/src/App.tsx`              |
| 5   | Add `expiresAt` countdown timer to reserved bounty cards         | `frontend/src/BountyCard.tsx`       |
| 6   | Add empty-state illustration when no bounties match filters      | `frontend/src/App.tsx`              |
| 7   | Add XLM → USD live conversion badge using CoinGecko              | `frontend/src/utils.ts`             |
| 8   | Add contributor profile link from bounty card                    | `frontend/src/BountyDetailPage.tsx` |

---

## Backend Issues (12)

| #   | Title                                                                                           | File/Dir                                           |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 9   | Document `reservationExpirationJob` configuration options in `.env.example` and `ONBOARDING.md` | `docs/issues/reservation-expiration-config.md`     |
| 10  | Add `/api/health` liveness and readiness endpoints                                              | `backend/src/app.ts`                               |
| 11  | Add Prometheus-compatible `/metrics` endpoint (request count, latency, active reservations)     | `backend/src/app.ts`                               |
| 12  | Add full-text search on bounty title and description via `?q=` param                            | `backend/src/routes/bounties.ts`                   |
| 13  | Add contributor leaderboard endpoint `GET /api/leaderboard`                                     | `backend/src/services/`                            |
| 14  | Add per-IP rate limiting using `express-rate-limit`                                             | `backend/src/middleware/`                          |
| 15  | Add request-id propagation header (`X-Request-ID`)                                              | `backend/src/middleware/requestContext.ts`         |
| 16  | Add integration test for concurrent reservation race condition                                  | `backend/test/`                                    |
| 17  | Migrate JSON store to SQLite via Drizzle ORM                                                    | `backend/data/`                                    |
| 18  | Add `BOUNTY_STORE_PATH` env var support for volume-mounted stores                               | `backend/src/services/reservationExpirationJob.ts` |
| 19  | Add graceful shutdown handler that calls `stopExpirationJob()`                                  | `backend/src/index.ts`                             |
| 20  | Add Zod schema for `RESERVATION_TTL_DAYS` and `EXPIRATION_CRON_INTERVAL_MS` at startup          | `backend/src/services/reservationExpirationJob.ts` |

---

## Smart Contract Issues (6)

| #   | Title                                                       | File                    |
| --- | ----------------------------------------------------------- | ----------------------- |
| 21  | Add on-chain `deadline` field with expiration enforcement   | `contracts/src/lib.rs`  |
| 22  | Add `dispute_bounty` function with arbiter resolution       | `contracts/src/lib.rs`  |
| 23  | Emit contract events for all state transitions              | `contracts/src/lib.rs`  |
| 24  | Add fuzz tests for invalid state transitions                | `contracts/src/test.rs` |
| 25  | Add test for refund after deadline expiration               | `contracts/src/test.rs` |
| 26  | Upgrade `soroban-sdk` to latest stable and fix deprecations | `contracts/Cargo.toml`  |

---

## Docs Issues (10)

| #   | Title                                                                          | File                                           |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| 27  | Document `reservationExpirationJob` config options (TTL, interval, store path) | `docs/issues/reservation-expiration-config.md` |
| 28  | Update `SECURITY.md` with full responsible disclosure timeline                 | `docs/issues/security-disclosure-process.md`   |
| 29  | Add Mermaid sequence diagram for bounty lifecycle                              | `docs/ARCHITECTURE.md`                         |
| 30  | Add on-chain vs off-chain data ownership table                                 | `docs/ARCHITECTURE.md`                         |
| 31  | Add configuration reference table for all env vars                             | `docs/ARCHITECTURE.md`                         |
| 32  | Add Railway one-click deployment guide                                         | `docs/deployment.md`                           |
| 33  | Add video walkthrough links and visual overview                                | `ONBOARDING.md`                                |
| 34  | Add ngrok setup guide for local webhook testing                                | `docs/webhook-signatures.md`                   |
| 35  | Add conventional commits cheatsheet to `CONTRIBUTING.md`                       | `CONTRIBUTING.md`                              |
| 36  | Add `docs/issues/` index listing all wave issue drafts                         | `docs/issues/README.md`                        |

---

## DevOps / Config Issues (4)

| #   | Title                                                                   | Location                   |
| --- | ----------------------------------------------------------------------- | -------------------------- |
| 37  | Add `gitleaks` secrets-scanning step to CI workflow                     | `.github/workflows/ci.yml` |
| 38  | Add Docker healthcheck instruction to backend `Dockerfile`              | `backend/Dockerfile`       |
| 39  | Add automated GitHub release workflow triggered on version tags         | `.github/workflows/`       |
| 40  | Add `CODEOWNERS` file to enforce review requirements on sensitive paths | Root                       |

---

## How to Contribute

1. Browse open issues tagged **wave-5**
2. Comment on the issue you want to pick up — first to comment gets priority
3. Fork the repo: `gh repo fork ritik4ever/stellar-bounty-board --clone`
4. Create a feature branch: `git checkout -b feat/your-feature-name`
5. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for commit style and PR format
6. Open a PR referencing the issue number: `Closes #<issue>`

For questions, open a Discussion or ping the maintainer in the issue thread.

---

_Wave 5 opened: 2026-05-28 · 40 issues across 5 areas_
