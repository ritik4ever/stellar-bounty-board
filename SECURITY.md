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

## Automated Security Analysis

This repository runs [GitHub CodeQL](https://codeql.github.com/) on the `javascript` language (which covers both JavaScript and TypeScript) for every push and pull request to `main`, plus a weekly scheduled scan. The workflow is defined at [.github/workflows/codeql.yml](.github/workflows/codeql.yml) and uses the `security-extended` and `security-and-quality` query suites. Alerts surface in the **Security** tab of the repository.

## Authentication Design

Maintainer wallet authorization is documented in [ADR 0002: Stellar Signature Authentication for Maintainer Actions](docs/adr/0002-stellar-signature-auth.md). The ADR explains why Stellar signatures are used instead of JWTs for payout authority, how verification works, how replay protection should be applied, and how `MAINTAINER_PUBLIC_KEYS` supports multi-key deployments.
