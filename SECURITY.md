# Security Policy

## Supported Versions

Only the latest version of the Stellar Bounty Board is currently supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| Active  | :white_check_mark: |

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

If you discover a potential security issue, report it privately using one of these channels:

- **GitHub Private Reporting** — use the [Report a vulnerability](../../security/advisories/new) button in the Security tab of this repository.
- **Email** — send details to `[Insert Security Email]` with the subject line `[SECURITY] <brief description>`.

Include the following in your report:

1. A clear description of the vulnerability and its potential impact.
2. Step-by-step reproduction instructions or a proof-of-concept (PoC).
3. Affected versions, components, or endpoints.
4. Any suggested mitigations (optional but appreciated).

We appreciate your help in keeping the Stellar ecosystem safe.

---

## Responsible Disclosure Timeline

We follow a **90-day coordinated disclosure** policy aligned with industry standards
(Google Project Zero, CERT/CC). The table below describes each phase, who is responsible,
and the expected timeframe after a report is received (Day 0).

| Phase                   | Window    | Responsible Party     | Action                                                                  |
| ----------------------- | --------- | --------------------- | ----------------------------------------------------------------------- |
| **Receipt**             | Day 0     | Reporter              | Submit via private email or GitHub private reporting.                   |
| **Acknowledgement**     | Day 0–2   | Maintainer            | Confirm receipt and assign a tracking ID.                               |
| **Triage**              | Day 2–7   | Maintainer            | Reproduce the issue, assess severity (CVSS v3.1), confirm scope.        |
| **Status Update**       | Day 7     | Maintainer            | Send a written status update to the reporter.                           |
| **Fix Development**     | Day 7–45  | Maintainer            | Develop patch on a private branch; draft GitHub Security Advisory.      |
| **Fix Review**          | Day 45–60 | Maintainer + Reporter | Internal review and testing. Reporter may be invited to verify the fix. |
| **Coordinated Release** | Day 60–90 | Maintainer            | Merge patch, tag release, publish GitHub Security Advisory.             |
| **Public Disclosure**   | Day 90    | Maintainer            | Publish full details. Credit reporter (with their consent).             |

### Emergency Track

For vulnerabilities that are **critical severity (CVSS ≥ 9.0)** or are being **actively exploited
in the wild**, we reserve the right to release a patch ahead of the 90-day schedule. We will
notify the reporter before doing so and coordinate timing where possible.

### Timeline Extensions

The 90-day window may be extended by mutual written agreement between the reporter and the
maintainer — for example, when a fix requires upstream dependency changes or coordinated
disclosure with a third party. Extensions will not exceed an additional 30 days without
re-evaluation.

---

## Our Commitments

| Commitment                       | SLA                                         |
| -------------------------------- | ------------------------------------------- |
| Acknowledge receipt              | Within **48 hours**                         |
| Provide triage status            | Within **7 days**                           |
| Deliver a fix or mitigation plan | Within **45 days** for high/critical issues |
| Public disclosure                | No later than **90 days** after receipt     |

---

## Credits

We publicly credit security reporters in the GitHub Security Advisory and in the release notes
for the patched version, unless the reporter requests anonymity. If you would like to be credited
under a specific name, handle, or organisation, please include that preference in your report.

---

## Logging best practices

The backend logger (`backend/src/logger.ts`, pino) redacts secrets two ways so
Stellar private keys and credentials never reach log output (#381):

- **Path redaction** masks named fields at any depth: `password`, `secret`,
  `token`, `apiKey`/`api_key`, `Authorization`, request `authorization` /
  `cookie` headers, and the Stellar key fields `secretKey`, `privateKey`,
  `seed`.
- **Value redaction** scrubs any string matching a Stellar secret seed
  (`^S[0-9A-Z]{55}$`) wherever it appears — including free-form error messages
  and nested objects — via a `logMethod` hook, replacing it with
  `[redacted-secret-key]`.

When adding logging:

- Never log a raw signed transaction, secret seed, or keypair. Log the public
  key (`G…`) or an opaque identifier instead.
- Prefer structured fields (`logger.info({ field }, "msg")`) over string
  interpolation so path redaction can apply.
- If you introduce a new field name that may carry a secret, add it to the
  `redact.paths` list in `backend/src/logger.ts`.

## Automated Security Analysis

This repository runs [GitHub CodeQL](https://codeql.github.com/) on the `javascript` language
(covering both JavaScript and TypeScript) for every push and pull request to `main`, plus a
weekly scheduled scan. The workflow is defined at
[.github/workflows/codeql.yml](.github/workflows/codeql.yml) and uses the
`security-extended` and `security-and-quality` query suites. Alerts surface in the **Security**
tab of the repository.

---

## Scope

The following are **in scope** for responsible disclosure:

- Authentication and authorisation bypass
- Remote code execution or server-side injection
- Sensitive data exposure (API keys, wallet addresses, user data)
- Cryptographic weaknesses in signature verification (`backend/src/webhooks/signatureVerification.ts`)
- Smart contract vulnerabilities in `contracts/src/`

The following are **out of scope**:

- Denial-of-service attacks requiring significant resources
- Social engineering of maintainers or contributors
- Vulnerabilities in third-party dependencies already tracked by Dependabot
- Issues in forks or unofficial deployments

---

_Last updated: 2026-05-28_
