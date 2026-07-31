# Wave 6 — Contribution Backlog

This document tracks the **Wave 6** contribution issues for Stellar Bounty Board.
Wave 6 focuses on production readiness: database migration, wallet authentication, GitHub integration,
contributor experience, and security documentation.

## Summary

| Area                              | Issues | Focus                                                       |
| --------------------------------- | ------ | ----------------------------------------------------------- |
| Frontend (`frontend/src/`)        | 2      | Contributor profiles, wallet authentication                  |
| Backend (`backend/src/`)          | 2      | Postgres migration, GitHub webhook integration              |
| Smart Contract (`contracts/src/`) | 0      |                                                             |
| Docs (`docs/`)                    | 3      | Security disclosure, configuration documentation             |
| DevOps / Config                   | 0      |                                                             |
| **Total**                         | **7**  |                                                             |

---

## Frontend Issues (2)

| # | Title | File |
|---|-------|------|
| 1 | Add contributor profile dashboard showing reserved, submitted, released, and refunded bounties with total earnings | `docs/issues/contributor-profile-dashboard.md` |
| 2 | Add Freighter wallet signing for maintainer release and refund actions | `docs/issues/wallet-auth-release-flow.md` |

---

## Backend Issues (2)

| # | Title | File/Dir |
|---|-------|----------|
| 3 | Replace JSON persistence with Postgres and add append-only audit log for bounty state transitions | `docs/issues/postgres-audit-log.md` |
| 4 | Add GitHub webhook endpoint to sync bounty submissions from pull request events | `docs/issues/github-pr-webhook-sync.md` |

---

## Smart Contract Issues (0)

No smart contract issues in this wave.

---

## Docs Issues (3)

| # | Title | File |
|---|-------|------|
| 5 | Document reservationExpirationJob configuration options in .env.example and ONBOARDING.md | `docs/issues/reservation-expiration-config.md` |
| 6 | Update SECURITY.md with full responsible disclosure timeline and phase breakdown | `docs/issues/security-disclosure-process.md` |
| 7 | Add security vulnerability disclosure issue template for GitHub | `docs/issues/security-disclosure.md` |

---

## DevOps / Config Issues (0)

No DevOps issues in this wave.

---

## Dependency Sequencing

Some issues have logical dependencies that should guide implementation order:

- **Postgres migration (#3) before GitHub webhook sync (#4)**: The webhook integration will benefit from structured database storage and audit logging capabilities.
- **Wallet auth (#2) can proceed independently**: This frontend feature can be developed in parallel with backend database work.
- **Security docs (#5, #6, #7) have no code dependencies**: These are pure documentation tasks that can be tackled anytime.
- **Contributor profile (#1) benefits from Postgres migration (#3)**: While the profile dashboard can work with the current JSON store, it will be more robust with proper database queries and aggregation.

**Suggested sequence:**
1. Start with documentation tasks (#5, #6, #7) — no dependencies, quick wins
2. Implement Postgres migration (#3) — foundational backend work
3. Build contributor profile dashboard (#1) — leverages improved data layer
4. Add GitHub webhook sync (#4) — builds on Postgres storage
5. Implement wallet authentication (#2) — independent frontend feature

---

## How to Contribute

1. Browse open issues tagged **wave-6**
2. Comment on the issue you want to pick up — first to comment gets priority
3. Fork the repo: `gh repo fork ritik4ever/stellar-bounty-board --clone`
4. Create a feature branch: `git checkout -b feat/your-feature-name`
5. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for commit style and PR format
6. Open a PR referencing the issue number: `Closes #<issue>`

For questions, open a Discussion or ping the maintainer in the issue thread.

---

*Wave 6 opened: 2026-07-27 · 7 issues across 3 areas*
