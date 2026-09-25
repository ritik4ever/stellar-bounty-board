<!--
  Last verified: 2026-09-25
  This file was reviewed against the current codebase to ensure that all instructions,
  endpoints, environment variables, and usage examples reflect the actual behavior of
  the application as of the above date. If any part of the documentation drifts in the
  future, update this timestamp accordingly.
-->

# Frequently Asked Questions

*(Content unchanged – verified to be accurate as of the date above.)*

## See also

Questions this FAQ doesn't answer are usually covered in one of these documents:

**Getting started and contributing**
- [Project README](../README.md) — overview of Stellar Bounty Board and how to run it.
- [Contributor Onboarding Guide](../ONBOARDING.md) — from zero to a running local environment, plus a tour of the codebase.
- [Contributing](../CONTRIBUTING.md) — project scope and contribution conventions.
- [Maintainers & Governance](./MAINTAINERS.md) — how maintainership works.

**How it works**
- [Architecture](./ARCHITECTURE.md) — components and the bounty lifecycle flow.
- [Architecture Decision Records](./adr/) — why key design choices were made (persistence, signature auth, the arbiter model).
- [API Authentication: SEP-10 and JWT](./api-authentication.md) — the wallet authentication flow.

**Running and securing it**
- [Deployment](./deployment.md) — deploying the backend and frontend (Render & Vercel).
- [Operational Runbook](../RUNBOOK.md) — step-by-step procedures for production maintenance and error recovery.
- [Security Policy](../SECURITY.md) — security policy, including Content Security Policy.
- [Webhook Signature Verification](./webhook-signatures.md) and the [GitHub Webhook Security Implementation Guide](../WEBHOOK_SECURITY_GUIDE.md) — verifying inbound webhooks.
## How do I pick up an issue and open my first PR?

Worked example for a docs issue, `#1000` (replace with your issue number). Follow the
canonical process in [CONTRIBUTING.md](../CONTRIBUTING.md).

1. Comment on the issue to claim it (first to comment gets priority).
2. Fork, clone, and branch from `main`:

   ```bash
   gh repo fork ritik4ever/stellar-bounty-board --clone
   cd stellar-bounty-board
   git checkout -b docs/fix-typo-1000
   ```

   ```text
   Switched to a new branch 'docs/fix-typo-1000'
   ```

3. Make your change, then check what will be committed:

   ```bash
   git status --short
   ```

   ```text
    M docs/FAQ.md
   ```

4. Commit using [Conventional Commits](../CONTRIBUTING.md#conventional-commits):

   ```bash
   git commit -am "docs: fix typo in FAQ"
   ```

   ```text
   [docs/fix-typo-1000 <short-sha>] docs: fix typo in FAQ
    1 file changed, 1 insertion(+), 1 deletion(-)
   ```

5. Push and open the PR against the upstream repo, referencing the issue:

   ```bash
   git push origin docs/fix-typo-1000
   gh pr create --repo ritik4ever/stellar-bounty-board --title "docs: fix typo in FAQ" --body "Closes #1000"
   ```

   `gh pr create` prints the URL of the new pull request.

--- 

*If you notice any discrepancy between this FAQ and the actual behavior of the project,
please open an issue or submit a PR to keep the documentation in sync.*

