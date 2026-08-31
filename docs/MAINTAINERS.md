# Maintainers & Governance

This document describes how maintainership works in **stellar-bounty-board** and how
community members can step up to help maintain the project.

## Roles

| Role | Permissions | Responsibilities |
|------|-------------|------------------|
| **Owner** | Full admin | Final decision-making, repository settings, releases, security incidents |
| **Maintainer** | Write / Maintain | Review and merge PRs, triage issues, manage labels, guide contributors |
| **Triage** | Triage | Label and triage issues, close duplicates, reproduce bug reports |
| **Contributor** | Read | Open issues and submit pull requests |

## How to become a maintainer

Maintainership is granted at the discretion of the repository owner. There is no
automated path to maintainer rights. If you are interested in helping maintain the
project, open a GitHub issue expressing your interest (see
[#1057](https://github.com/ritik4ever/stellar-bounty-board/issues/1057) for an example)
or reach out to the owner directly.

The owner typically considers:

- A consistent history of high-quality, merged pull requests.
- Familiarity with the project's architecture, smart contract design, and goals.
- A demonstrated willingness to review others' work and help with triage.
- A clear statement of which responsibilities you'd like to take on (e.g., PR review,
  issue triage, documentation, test coverage).

## Onboarding a new maintainer

When the owner decides to grant maintainer or triage rights:

1. The owner adds the contributor as a collaborator with the appropriate role via
   **Settings → Collaborators** in the GitHub repository.
2. The new maintainer is added to the project's communication channels.
3. The new maintainer reviews the project's
   [CONTRIBUTING.md](../CONTRIBUTING.md), [ONBOARDING.md](../ONBOARDING.md), and
   [SECURITY.md](../SECURITY.md) to understand contribution and security expectations.
4. For the first few weeks, the new maintainer focuses on triage and PR review before
   being granted merge rights, if a trial period is desired.

## Expectations

- Follow the [Conventional Commits](../CONTRIBUTING.md#conventional-commits) standard.
- Keep the review queue moving and help contributors land their work.
- Maintain test coverage and documentation.
- Follow the responsible disclosure process in [SECURITY.md](../SECURITY.md).
