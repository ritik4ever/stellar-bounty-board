# Wave 4 — Contribution Backlog

This document tracks the **Wave 4** contribution issues for Stellar Bounty Board.
Wave 4 expands the MVP into a production-ready platform across frontend, backend,
smart contracts, docs, and DevOps.

## Summary

| Area | Issues | Focus |
|------|--------|-------|
| Frontend (`frontend/src/`) | 15 | Component extraction, UX, API resilience |
| Backend (`backend/src/`) | 20 | Auth, persistence, webhooks, search, observability |
| Smart Contract (`contracts/src/`) | 10 | Soroban features, events, fuzz tests |
| Docs (`docs/`) | 8 | Architecture diagrams, deployment guides |
| DevOps / Config | 7 | CI/CD, Docker, issue templates |
| **Total** | **60** | |

---

## Frontend Issues (15)

| # | Title | File |
|---|-------|------|
| 1 | Extract `BountyCard` into its own component file | `frontend/src/App.tsx` |
| 2 | Add dark mode toggle with localStorage persistence | `frontend/src/App.tsx` |
| 3 | Add bounty list pagination (10 items per page) | `frontend/src/App.tsx` |
| 4 | Add filter by bounty status (open/reserved/submitted/released/refunded) | `frontend/src/App.tsx` |
| 5 | Add sort by amount (high → low / low → high) | `frontend/src/App.tsx` |
| 6 | Add retry logic with exponential backoff for failed API requests | `frontend/src/api.ts` |
| 7 | Add AbortController support for request cancellation on unmount | `frontend/src/api.ts` |
| 8 | Add `expiresAt` and `tags` fields to Bounty type | `frontend/src/types.ts` |
| 9 | Add XLM → USD conversion utility using CoinGecko exchange rate | `frontend/src/utils.ts` |
| 10 | Add copy-to-clipboard for bounty ID and wallet address | `frontend/src/BountyDetailPage.tsx` |
| 11 | Add bounty activity timeline / audit log view | `frontend/src/BountyDetailPage.tsx` |
| 12 | Add skill-tag filtering to recommendation engine | `frontend/src/RecommendedBounties.tsx` |
| 13 | Render GitHub issue label chips in issue preview card | `frontend/src/GitHubIssuePreviewCard.tsx` |
| 14 | Add responsive mobile layout for screens < 768px | `frontend/src/index.css` |
| 15 | Add contributor skill-matching algorithm | `frontend/src/recommendations.ts` |

---

## Backend Issues (20)

| # | Title | File/Dir |
|---|-------|----------|
| 16 | Add rate limiting per IP using express-rate-limit | `backend/src/app.ts` |
| 17 | Add X-Request-ID header for distributed tracing | `backend/src/app.ts` |
| 18 | Add Swagger/OpenAPI 3.0 docs at `/api/docs` | `backend/src/app.ts` |
| 19 | Add `GET /api/stats` endpoint (total bounties, XLM locked, open count) | `backend/src/app.ts` |
| 20 | Add `GET /api/bounties/:id` endpoint for single bounty lookup | `backend/src/app.ts` |
| 21 | Add bounty auto-expiration cron job (mark stale reservations) | `backend/src/services/` |
| 22 | Add contributor leaderboard service (top earners by XLM) | `backend/src/services/` |
| 23 | Add full-text bounty search endpoint with `?q=` query param | `backend/src/services/` |
| 24 | Add Freighter / SEP-10 JWT wallet auth middleware | `backend/src/middleware/` |
| 25 | Add structured request/response logging middleware (Pino) | `backend/src/middleware/` |
| 26 | Tighten CORS to allowlist origins for production | `backend/src/middleware/` |
| 27 | Add stricter Zod schema: min/max XLM amounts with decimal precision | `backend/src/validation/` |
| 28 | Add GitHub PR URL format validation in submit route | `backend/src/validation/` |
| 29 | Implement GitHub webhook HMAC-SHA256 signature verification | `backend/src/webhooks/` |
| 30 | Add PR-merged webhook → auto-release bounty handler | `backend/src/webhooks/` |
| 31 | Add retry with exponential backoff for failed Soroban event indexing | `backend/worker/` |
| 32 | Add worker health-check endpoint at `/worker/health` | `backend/worker/` |
| 33 | Migrate from JSON file persistence to SQLite via Drizzle ORM | `backend/data/` |
| 34 | Add integration tests for concurrent reservation race condition | `backend/test/` |
| 35 | Add Stellar/Soroban address format validation utility | `backend/src/utils.ts` |

---

## Smart Contract Issues (10)

| # | Title | File |
|---|-------|------|
| 36 | Add `deadline` field with on-chain expiration enforcement | `contracts/src/lib.rs` |
| 37 | Add multi-token support (USDC, native XLM, custom SAC tokens) | `contracts/src/lib.rs` |
| 38 | Add `dispute_bounty` function with arbiter resolution flow | `contracts/src/lib.rs` |
| 39 | Emit contract events for all state transitions (create/reserve/submit/release/refund) | `contracts/src/lib.rs` |
| 40 | Add maintainer fee percentage parameter to `create_bounty` | `contracts/src/lib.rs` |
| 41 | Add `extend_deadline` function for maintainers | `contracts/src/lib.rs` |
| 42 | Add test for concurrent reservation race condition | `contracts/src/test.rs` |
| 43 | Add test for refund after deadline expiration | `contracts/src/test.rs` |
| 44 | Add fuzz tests for invalid state transitions | `contracts/src/test.rs` |
| 45 | Upgrade soroban-sdk to latest stable and fix deprecations | `contracts/Cargo.toml` |

---

## Docs Issues (8)

| # | Title | File |
|---|-------|------|
| 46 | Add Mermaid sequence diagrams for each bounty lifecycle action | `docs/ARCHITECTURE.md` |
| 47 | Add on-chain vs off-chain data ownership comparison table | `docs/ARCHITECTURE.md` |
| 48 | Add Docker + Docker Compose deployment guide | `docs/deployment.md` |
| 49 | Add Railway one-click deployment as alternative to Render | `docs/deployment.md` |
| 50 | Add ngrok setup guide for local GitHub webhook testing | `docs/webhook-signatures.md` |
| 51 | Add security vulnerability disclosure issue template | `docs/issues/` |
| 52 | Add video walkthrough links and visual architecture overview | `ONBOARDING.md` |
| 53 | Add conventional commits cheatsheet and PR checklist | `CONTRIBUTING.md` |

---

## DevOps / Config Issues (7)

| # | Title | Location |
|---|-------|----------|
| 54 | Add CI workflow: install → lint → test → contract build on every PR | `.github/workflows/` |
| 55 | Add Dependabot config for automated dependency updates | `.github/` |
| 56 | Add bug-report and feature-request issue templates | `.github/ISSUE_TEMPLATE/` |
| 57 | Add lint-staged + Husky for pre-commit type-check and lint | `package.json` |
| 58 | Add Docker Compose file for local full-stack development | Root |
| 59 | Add `.env.example` with all required environment variables | Root |
| 60 | Add GitHub Actions label-bot workflow for automatic PR labeling | `.github/workflows/` |

---

## How to Contribute

1. Browse open issues tagged **wave-4**
2. Comment on the issue you want to pick up — first to comment gets priority
3. Fork the repo: `gh repo fork ritik4ever/stellar-bounty-board --clone`
4. Create a feature branch: `git checkout -b feat/your-feature-name`
5. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for commit style and PR format
6. Open a PR referencing the issue number: `Closes #<issue>`

For questions, open a Discussion or ping the maintainer in the issue thread.

---

*Wave 4 opened: 2026-04-22 · 60 issues across 5 areas*
