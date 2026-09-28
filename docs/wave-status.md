# Wave Status — Backlog Reconciliation

**Snapshot taken: 2026-09-28** (against the live tracker of
[`ritik4ever/stellar-bounty-board`](https://github.com/ritik4ever/stellar-bounty-board)).

## What this document is

[`docs/wave-4.md`](wave-4.md) (60 items), [`docs/wave-5.md`](wave-5.md) (40 items) and
[`docs/wave-6.md`](wave-6.md) (7 items) are **static planning snapshots** — 107 planned
line items in total. They say what was *intended*, not what is still open, already
shipped, or superseded by a later wave.

This file is the single place that answers that question. Every line item from all
three wave documents appears exactly once below, with the GitHub issue that carries it
today and that issue's current state. `#NNN` refers to an issue in this repository.

Pick work from here, not from the wave documents: a wave document alone cannot tell you
whether its item was delivered three waves ago.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `open` | The mapped issue exists and is **open** — the work is available (or in progress). |
| `closed` | The mapped issue exists and is **closed** — the work landed. |
| `superseded` | The mapped issue is closed, but a **later wave** restates the same work against a different issue. The note names the surviving item, which is the one to track. |
| `not-opened` | No GitHub issue exists for this line item yet. The wave document describes it; nobody has opened it. |

A `closed` row whose note says "duplicate" means the same work was tracked by more than
one issue (waves 4 and 5 overlap heavily); all of those issues are closed, so the row is
still delivered work, not an open item.

## Headline numbers

| Metric | Count |
| --- | --- |
| Backlog line items across waves 4–6 | 107 |
| Mapped to a live issue | 101 |
| Not yet opened | 6 |
| Superseded by a later wave | 3 |
| Still open and available | 2 — `#81` (per-IP rate limiting), `#1449` (PR merge → bounty sync) |

## Wave 4 — 60 items

| Item | Backlog title | Issue | Status | Notes |
| --- | --- | --- | --- | --- |
| W4.1 | Extract `BountyCard` into its own component file | #66 | closed | Duplicate: #821 |
| W4.2 | Add dark mode toggle with localStorage persistence | #68 | closed | Duplicate: #298 |
| W4.3 | Add bounty list pagination (10 items per page) | #8 | closed |  |
| W4.4 | Add filter by bounty status | #67 | closed | Duplicate: #292 |
| W4.5 | Add sort by amount | #65 | closed | Duplicate: #294 |
| W4.6 | Add retry logic with exponential backoff for failed API requests | #72 | closed | Duplicate: #28 |
| W4.7 | Add AbortController support for request cancellation on unmount | #70 | closed |  |
| W4.8 | Add `expiresAt` and `tags` fields to Bounty type | #69 | closed |  |
| W4.9 | Add XLM to USD conversion utility using CoinGecko exchange rate | #71 | closed | Duplicate: #288 (see W5.7); staleness policy still open in #1174 |
| W4.10 | Add copy-to-clipboard for bounty ID and wallet address | #73 | closed | Duplicate: #295 |
| W4.11 | Add bounty activity timeline / audit log view | #74 | closed |  |
| W4.12 | Add skill-tag filtering to recommendation engine | #75 | closed | Overlaps W4.15; scoring algorithm still undocumented (#1171) |
| W4.13 | Render GitHub issue label chips in issue preview card | #76 | closed |  |
| W4.14 | Add responsive mobile layout for screens below 768px | not-opened | not-opened | Per-file small-viewport work exists separately (#1263, #1295) but no issue covers this item |
| W4.15 | Add contributor skill-matching algorithm | #122 | closed | Duplicate: #120; overlaps W4.12 |
| W4.16 | Add rate limiting per IP using express-rate-limit | #81 | open | Same issue as W5.14. Read and mutation tiers exist; this item is still open on the tracker |
| W4.17 | Add X-Request-ID header for distributed tracing | #79 | closed | Duplicate: #268 (see W5.15) |
| W4.18 | Add Swagger/OpenAPI 3.0 docs at `/api/docs` | #80 | closed | Duplicate: #21 |
| W4.19 | Add `GET /api/stats` endpoint | #78 | closed | Duplicate: #239; frontend surface still open in #1458 |
| W4.20 | Add `GET /api/bounties/:id` endpoint for single bounty lookup | #77 | closed |  |
| W4.21 | Add bounty auto-expiration cron job | #84 | closed |  |
| W4.22 | Add contributor leaderboard service | #82 | closed | Duplicate: #238 (see W5.13) |
| W4.23 | Add full-text bounty search endpoint with `?q=` query param | #85 | closed | Same issue as W5.12; duplicate: #783 |
| W4.24 | Add Freighter / SEP-10 JWT wallet auth middleware | #86 | closed | Follow-on wallet-auth work open in #1448 |
| W4.25 | Add structured request/response logging middleware (Pino) | #83 | closed | Duplicate: #276; cross-service correlation still open in #1457 |
| W4.26 | Tighten CORS to allowlist origins for production | #88 | closed | Duplicate: #256 |
| W4.27 | Add stricter Zod schema for XLM amounts and decimals | #87 | closed |  |
| W4.28 | Add GitHub PR URL format validation in submit route | #89 | closed |  |
| W4.29 | Implement GitHub webhook HMAC-SHA256 signature verification | #90 | closed | Canonical-docs gap open in #1164 |
| W4.30 | Add PR-merged webhook to auto-release bounty handler | #91 | superseded | Superseded by W6.5, which is tracked in the still-open #1449 |
| W4.31 | Add retry with exponential backoff for failed Soroban event indexing | #94 | closed |  |
| W4.32 | Add worker health-check endpoint at `/worker/health` | #92 | closed |  |
| W4.33 | Migrate from JSON file persistence to SQLite via Drizzle ORM | #93 | superseded | Superseded by W6.1; Postgres migration tracked in #767 (closed) with follow-ups #1450 and #879 |
| W4.34 | Add integration tests for concurrent reservation race condition | #96 | closed | Same issue as W5.16 |
| W4.35 | Add Stellar/Soroban address format validation utility | #95 | closed |  |
| W4.36 | Add `deadline` field with on-chain expiration enforcement | #100 | closed | Same issue as W5.21 |
| W4.37 | Add multi-token support | #101 | closed |  |
| W4.38 | Add `dispute_bounty` function with arbiter resolution flow | #97 | closed | Same issue as W5.22 |
| W4.39 | Emit contract events for all state transitions | #99 | closed | Same issue as W5.23; per-function event gaps open in the #1236–#1249 range |
| W4.40 | Add maintainer fee percentage parameter to `create_bounty` | #98 | closed |  |
| W4.41 | Add `extend_deadline` function for maintainers | #105 | closed |  |
| W4.42 | Add test for concurrent reservation race condition (contract) | #102 | closed |  |
| W4.43 | Add test for refund after deadline expiration | #103 | closed | Same issue as W5.25 |
| W4.44 | Add fuzz tests for invalid state transitions | #123 | closed | Duplicate: #121; same issue as W5.24 |
| W4.45 | Upgrade soroban-sdk to latest stable and fix deprecations | #104 | closed | Duplicate: #761; same issue as W5.26 |
| W4.46 | Add Mermaid sequence diagrams for each bounty lifecycle action | #107 | closed | Duplicate: #337; same issue as W5.29 |
| W4.47 | Add on-chain vs off-chain data ownership comparison table | #106 | closed | Same issue as W5.30 |
| W4.48 | Add Docker and Docker Compose deployment guide | #109 | closed |  |
| W4.49 | Add Railway one-click deployment as alternative to Render | #108 | closed | Same issue as W5.32 |
| W4.50 | Add ngrok setup guide for local GitHub webhook testing | #110 | closed | Same issue as W5.34 |
| W4.51 | Add security vulnerability disclosure issue template | #111 | closed | Same issue as W6.7 |
| W4.52 | Add video walkthrough links and visual architecture overview | #112 | closed | Same issue as W5.33 |
| W4.53 | Add conventional commits cheatsheet and PR checklist | #113 | closed | Same issue as W5.35 |
| W4.54 | Add CI workflow: install, lint, test, contract build on every PR | #115 | closed |  |
| W4.55 | Add Dependabot config for automated dependency updates | #116 | closed |  |
| W4.56 | Add bug-report and feature-request issue templates | #114 | closed |  |
| W4.57 | Add lint-staged and Husky for pre-commit type-check and lint | #118 | closed | Duplicate: #325 |
| W4.58 | Add Docker Compose file for local full-stack development | #117 | closed |  |
| W4.59 | Add `.env.example` with all required environment variables | #124 | closed |  |
| W4.60 | Add GitHub Actions label-bot workflow for automatic PR labeling | #119 | closed |  |

## Wave 5 — 40 items

| Item | Backlog title | Issue | Status | Notes |
| --- | --- | --- | --- | --- |
| W5.1 | Add React error boundary around bounty list and detail views | #297 | closed |  |
| W5.2 | Add ARIA labels and keyboard navigation to BountyCard | #300 | closed |  |
| W5.3 | Add skeleton loading state while bounties are fetching | #284 | closed |  |
| W5.4 | Add toast notification system for reserve/submit/release actions | #299 | closed |  |
| W5.5 | Add `expiresAt` countdown timer to reserved bounty cards | #296 | closed |  |
| W5.6 | Add empty-state illustration when no bounties match filters | #306 | closed |  |
| W5.7 | Add XLM to USD live conversion badge using CoinGecko | #288 | closed | Restates W4.9; staleness policy still open in #1174 |
| W5.8 | Add contributor profile link from bounty card | not-opened | not-opened | The profile page itself shipped as #290; no issue covers the card-side link |
| W5.9 | Document `reservationExpirationJob` configuration options | #342 | closed | Same issue as W5.27 and W6.2 |
| W5.10 | Add `/api/health` liveness and readiness endpoints | not-opened | not-opened | Deep health checks shipped as #253; separate liveness/readiness endpoints were never opened |
| W5.11 | Add Prometheus-compatible `/metrics` endpoint | #362 | closed |  |
| W5.12 | Add full-text search on bounty title and description via `?q=` | #85 | closed | Same issue as W4.23 |
| W5.13 | Add contributor leaderboard endpoint `GET /api/leaderboard` | #238 | closed | Restates W4.22 |
| W5.14 | Add per-IP rate limiting using `express-rate-limit` | #81 | open | Same issue as W4.16; the webhook-specific tier from #1460 is tracked separately |
| W5.15 | Add request-id propagation header | #268 | closed | Restates W4.17 |
| W5.16 | Add integration test for concurrent reservation race condition | #96 | closed | Same issue as W4.34 |
| W5.17 | Migrate JSON store to SQLite via Drizzle ORM | #93 | superseded | Superseded by W6.1 |
| W5.18 | Add `BOUNTY_STORE_PATH` env var support for volume-mounted stores | #250 | closed |  |
| W5.19 | Add graceful shutdown handler that calls `stopExpirationJob()` | #266 | closed |  |
| W5.20 | Add Zod schema for `RESERVATION_TTL_DAYS` and `EXPIRATION_CRON_INTERVAL_MS` at startup | not-opened | not-opened | Adjacent work shipped as #244; startup validation of these two variables was never opened |
| W5.21 | Add on-chain `deadline` field with expiration enforcement | #100 | closed | Restates W4.36 |
| W5.22 | Add `dispute_bounty` function with arbiter resolution | #97 | closed | Restates W4.38 |
| W5.23 | Emit contract events for all state transitions | #99 | closed | Restates W4.39 |
| W5.24 | Add fuzz tests for invalid state transitions | #123 | closed | Restates W4.44 |
| W5.25 | Add test for refund after deadline expiration | #103 | closed | Restates W4.43 |
| W5.26 | Upgrade `soroban-sdk` to latest stable and fix deprecations | #104 | closed | Restates W4.45 |
| W5.27 | Document `reservationExpirationJob` config options | #342 | closed | Restates W5.9 |
| W5.28 | Update `SECURITY.md` with full responsible disclosure timeline | #388 | closed | Restates W6.6; timeline still missing per #1172 |
| W5.29 | Add Mermaid sequence diagram for bounty lifecycle | #337 | closed | Restates W4.46 |
| W5.30 | Add on-chain vs off-chain data ownership table | #106 | closed | Restates W4.47 |
| W5.31 | Add configuration reference table for all env vars | not-opened | not-opened | #124 documents variables in `.env.example`, but no consolidated reference table was ever opened |
| W5.32 | Add Railway one-click deployment guide | #108 | closed | Restates W4.49 |
| W5.33 | Add video walkthrough links and visual overview | #112 | closed | Restates W4.52 |
| W5.34 | Add ngrok setup guide for local webhook testing | #110 | closed | Restates W4.50 |
| W5.35 | Add conventional commits cheatsheet to `CONTRIBUTING.md` | #113 | closed | Restates W4.53 |
| W5.36 | Add `docs/issues/` index listing all wave issue drafts | #891 | closed | Duplicate: #344 |
| W5.37 | Add `gitleaks` secrets-scanning step to CI workflow | #323 | closed | Historical-scan gap open in #876 |
| W5.38 | Add Docker healthcheck instruction to backend `Dockerfile` | not-opened | not-opened | The root `Dockerfile` already carries a `HEALTHCHECK`; `backend/Dockerfile` still has none and no issue tracks adding one. Adjacent checklist issues: #1412–#1415 |
| W5.39 | Add automated GitHub release workflow triggered on version tags | #860 | closed |  |
| W5.40 | Add `CODEOWNERS` file to enforce review requirements on sensitive paths | #858 | closed | Duplicate: #1461 |

## Wave 6 — 7 items

| Item | Backlog title | Issue | Status | Notes |
| --- | --- | --- | --- | --- |
| W6.1 | Replace JSON persistence with Postgres and audit logs | #767 | closed | Survives W4.33 and W5.17; audit-log side still open in #1450, migration guide in #879, data-migration plan in #1169 |
| W6.2 | Document the `reservationExpirationJob` configuration options | #342 | closed | Same issue as W5.9 and W5.27 |
| W6.3 | Add contributor profile dashboard | #290 | closed | Duplicate: #286; reputation and heatmap panels tracked in #828 and #839 |
| W6.4 | Add Freighter wallet signing for maintainer actions | #210 | closed | Later, broader wallet-auth work open in #1448 |
| W6.5 | Sync bounty submissions from GitHub pull requests | #1449 | open | Supersedes W4.30; the earlier handler (#91) is closed |
| W6.6 | Update `SECURITY.md` with full responsible disclosure timeline | #388 | closed | Same issue as W5.28 |
| W6.7 | Security disclosure issue template (reporter-facing) | #111 | closed | Same issue as W4.51 |

## How this stays current

This document is part of the PR workflow, not a one-off snapshot:

1. **Every PR that closes a wave item** flips that item's status row here in the same PR,
   along with the issue number if the mapping changed. This is the same rule as
   [`docs/issues/README.md`](issues/README.md): if you change the backlog, update the
   index in the same commit.
2. **Every PR runs the structural check** — `npm run check:wave-status`, wired into
   [`.github/workflows/pr-check.yml`](../.github/workflows/pr-check.yml). It fails when a
   wave document gains, loses or renumbers a line item without a matching row here, when
   a row points at an item that no longer exists, when the issue cell is neither `#<n>`
   nor `not-opened`, or when a status is outside the vocabulary above. A new
   `docs/wave-N.md` is picked up automatically, so the next wave must be reconciled too.
3. **A scheduled job detects drift** — `node scripts/check-wave-status.mjs --live` runs
   weekly from [`.github/workflows/wave-status-drift.yml`](../.github/workflows/wave-status-drift.yml)
   and compares every mapped issue against its live state in the tracker. When issues
   open or close, it fails and asks for a refreshed snapshot rather than letting this
   file quietly become another stale planning document.

Related open work on the backlog itself: [`#1170`](https://github.com/ritik4ever/stellar-bounty-board/issues/1170)
(automated sync check across the wave documents) and
[`#1464`](https://github.com/ritik4ever/stellar-bounty-board/issues/1464) (changelog
distinguishing wave delivery from ad-hoc fixes).
