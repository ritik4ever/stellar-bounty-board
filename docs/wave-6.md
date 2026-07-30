# Wave 6 — Contribution Backlog

This document tracks the **Wave 6** contribution issues for Stellar Bounty Board.
Wave 6 focuses on completing the integration layer, hardening data persistence,
improving the contributor experience, and closing documentation gaps left by Wave 5.

> **Individual issue drafts** are in [`docs/issues/`](issues/README.md).  
> The index in that folder lists every draft with its category, title, and link.

## Summary

| Area | Issues | Focus |
|------|--------|-------|
| Backend (`backend/src/`) | 2 | Postgres migration, GitHub webhook sync |
| Frontend (`frontend/src/`) | 2 | Contributor profile dashboard, wallet signing |
| Integrations | 1 | GitHub PR → bounty state sync |
| Docs / Security | 2 | Responsible disclosure timeline, security template |
| **Total** | **7** | |

---

## Backend Issues (2)

| # | Title | Draft |
|---|-------|-------|
| 1 | Replace JSON Persistence With Postgres And Audit Logs | [postgres-audit-log.md](issues/postgres-audit-log.md) |
| 2 | Document the `reservationExpirationJob` Configuration Options | [reservation-expiration-config.md](issues/reservation-expiration-config.md) |

---

## Frontend Issues (2)

| # | Title | Draft |
|---|-------|-------|
| 3 | Add Contributor Profile Dashboard | [contributor-profile-dashboard.md](issues/contributor-profile-dashboard.md) |
| 4 | Add Freighter Wallet Signing For Maintainer Actions | [wallet-auth-release-flow.md](issues/wallet-auth-release-flow.md) |

---

## Integrations (1)

| # | Title | Draft |
|---|-------|-------|
| 5 | Sync Bounty Submissions From GitHub Pull Requests | [github-pr-webhook-sync.md](issues/github-pr-webhook-sync.md) |

---

## Docs / Security Issues (2)

| # | Title | Draft |
|---|-------|-------|
| 6 | Update `SECURITY.md` With Full Responsible Disclosure Timeline | [security-disclosure-process.md](issues/security-disclosure-process.md) |
| 7 | Security Disclosure issue template (reporter-facing) | [security-disclosure.md](issues/security-disclosure.md) |

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

*Wave 6 opened: 2026-07-25 · 7 issues across 4 areas*
