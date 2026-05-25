# Security Policy

## Supported Versions
Only the latest version of the Stellar Bounty Board is currently supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| Active  | :white_check_mark: |

## Reporting a Vulnerability
**Please do not open a public GitHub issue for security vulnerabilities.**

If you discover a potential security issue, please report it privately by emailing [Insert Email or Use GitHub Private Reporting]. We appreciate your help in keeping the Stellar ecosystem safe.

## Logging Secrets
Never log Stellar secret keys or seed phrases. Backend logging redacts common secret fields (`secretKey`, `privateKey`, `seed`, `token`, `apiKey`, and related header fields) and any Stellar secret-key shaped value before output. Keep public account IDs visible for debugging, but move any private material through secure storage or request-scoped memory only.

### Our Commitment
* **Acknowledge:** We will acknowledge receipt of your report within **48 hours** (SLA).
* **Triage:** We will provide a status update after initial triage.
* **Disclosure:** We follow a responsible disclosure timeline of **90 days** before public release, though we aim to fix critical issues much faster.
