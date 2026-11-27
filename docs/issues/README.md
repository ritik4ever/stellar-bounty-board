# docs/issues — Issue Draft Index

This index lists every issue draft in `docs/issues/`. Each entry links to its draft
file, shows its category, and carries a short description.

Issues are grouped by the same categories used in the wave summary documents so that
cross-referencing wave docs and individual drafts stays consistent.

---

## How to use this index

| Task | Action |
|------|--------|
| Pick up a documented issue | Open the linked draft, read the acceptance criteria, then claim the GitHub issue |
| Add a new draft | Create `docs/issues/<slug>.md`, add a row to the relevant table below, and update the wave summary doc |
| Start a new wave | Append a new **Wave N** section at the bottom of this file following the same table format |

---

## Wave 5 Issues

> Wave 5 summary: [`docs/wave-5.md`](../wave-5.md)  
> Opened: 2026-05-28 · 40 issues across 5 areas

### Backend

| Draft file | Title | Labels |
|------------|-------|--------|
| [reservation-expiration-config.md](reservation-expiration-config.md) | Document the `reservationExpirationJob` Configuration Options | `documentation`, `backend`, `good first issue` |
| [postgres-audit-log.md](postgres-audit-log.md) | Replace JSON Persistence With Postgres And Audit Logs | `backend`, `database`, `help wanted` |

### Frontend

| Draft file | Title | Labels |
|------------|-------|--------|
| [contributor-profile-dashboard.md](contributor-profile-dashboard.md) | Add Contributor Profile Dashboard | `frontend`, `good first issue` |
| [wallet-auth-release-flow.md](wallet-auth-release-flow.md) | Add Freighter Wallet Signing For Maintainer Actions | `enhancement`, `wallet`, `help wanted` |

### Integrations

| Draft file | Title | Labels |
|------------|-------|--------|
| [github-pr-webhook-sync.md](github-pr-webhook-sync.md) | Sync Bounty Submissions From GitHub Pull Requests | `integration`, `github`, `help wanted` |

### Docs / Security

| Draft file | Title | Labels |
|------------|-------|--------|
| [security-disclosure-process.md](security-disclosure-process.md) | Update `SECURITY.md` With Full Responsible Disclosure Timeline | `documentation`, `security`, `good first issue` |
| [security-disclosure.md](security-disclosure.md) | Security Disclosure issue template (reporter-facing) | `security` |

---

## Adding a new wave

When a new wave of issues is drafted:

1. Create individual draft files in `docs/issues/<slug>.md` using the existing files as
   a template (title, labels, summary, acceptance criteria, files to edit).
2. Add a new `## Wave N Issues` section **at the bottom** of this file.
3. Group entries by category using the headings: **Contracts**, **Backend**, **Frontend**,
   **DevOps**, **Docs**, **Testing / Security**.
4. Create the wave summary doc at `docs/wave-N.md` following the format of
   [`wave-5.md`](../wave-5.md).
5. Cross-link: add a `> Wave N summary: [docs/wave-N.md](../wave-N.md)` note under the
   new section header.
6. Open a PR with both the individual drafts and the updated index in the same commit so
   reviewers can see the full set at once.

---

*Index maintained by the core team. Last updated: Wave 5 (2026-05-28).*
