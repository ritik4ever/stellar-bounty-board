# Security Policy

## Supported Versions
Only the latest version of the Stellar Bounty Board is currently supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| Active  | :white_check_mark: |

## Reporting a Vulnerability
**Please do not open a public GitHub issue for security vulnerabilities.**

If you discover a potential security issue, please report it privately by emailing [Insert Email or Use GitHub Private Reporting]. We appreciate your help in keeping the Stellar ecosystem safe.

### Our Commitment
* **Acknowledge:** We will acknowledge receipt of your report within **48 hours** (SLA).
* **Triage:** We will provide a status update after initial triage.
* **Disclosure:** We follow a responsible disclosure timeline of **90 days** before public release, though we aim to fix critical issues much faster.

## Logging Best Practices

The backend uses [pino](https://getpino.io/) for structured logging. The following safeguards are in place to prevent sensitive data from appearing in logs:

1. **Path-based redaction** — Fields named `secretKey`, `privateKey`, `seed`, `password`, `secret`, `token`, `apiKey`, `api_key`, `Authorization`, and HTTP `authorization` / `cookie` headers are automatically replaced with `[redacted]`.
2. **Regex-based Stellar key redaction** — Any string value matching the Stellar secret-key pattern (`S` followed by 55 uppercase alphanumeric characters, e.g. `^S[0-9A-Z]{55}$`) is redacted regardless of its key name, via the `formatters.log` hook.
3. **Tests** — `backend/test/logger.test.ts` verifies both path-based and regex-based redaction.

When adding new log statements, avoid passing raw Stellar secret keys, private keys, or seeds as log fields. The redaction mechanisms act as a safety net but should not be relied upon as the sole protection.

## Automated Security Analysis

This repository runs [GitHub CodeQL](https://codeql.github.com/) on the `javascript` language (which covers both JavaScript and TypeScript) for every push and pull request to `main`, plus a weekly scheduled scan. The workflow is defined at [.github/workflows/codeql.yml](.github/workflows/codeql.yml) and uses the `security-extended` and `security-and-quality` query suites. Alerts surface in the **Security** tab of the repository.
