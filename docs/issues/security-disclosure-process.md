# Security Disclosure Process

## 1. Reporting a Vulnerability

If you discover a potential security issue, please do not open a public GitHub issue. Instead, report it privately using one of these channels:

- **GitHub Private Reporting** — use the [Report a vulnerability](https://github.com/ritik4ever/stellar-bounty-board/security/advisories/new) button in the Security tab of this repository.
- **Email** — send details to security@stellarbountyboard.com with the subject line `[SECURITY] <brief description>`.

Include the following in your report:
- A clear description of the vulnerability and its potential impact.
- Step-by-step reproduction instructions or a proof-of-concept (PoC).
- Affected versions, components, or endpoints.

## 2. SLA Timelines and Commitments

We are committed to addressing security vulnerabilities promptly. Our Service Level Agreements (SLAs) vary based on the severity (CVSS v3.1) of the issue:

| Severity | CVSS Score | Acknowledgement | Triage/Status Update | Fix Development |
| -------- | ---------- | --------------- | -------------------- | --------------- |
| Critical | 9.0 - 10.0 | Within 48 hours | Within 2 days        | Within 7 days   |
| High     | 7.0 - 8.9  | Within 48 hours | Within 5 days        | Within 14 days  |
| Medium   | 4.0 - 6.9  | Within 48 hours | Within 7 days        | Within 45 days  |
| Low      | 0.1 - 3.9  | Within 48 hours | Within 7 days        | Within 90 days  |

*Note: Fix Development SLA represents the maximum time before a fix or mitigation is delivered.*

## 3. Coordinated Disclosure Timeline

We follow a 90-day coordinated disclosure policy:

| Phase                   | Window    | Responsible Party     | Action                                                                  |
| ----------------------- | --------- | --------------------- | ----------------------------------------------------------------------- |
| **Receipt**             | Day 0     | Reporter              | Submit via private email or GitHub private reporting.                   |
| **Acknowledgement**     | Day 0–2   | Maintainer            | Confirm receipt and assign a tracking ID.                               |
| **Triage**              | Day 2–7   | Maintainer            | Reproduce the issue, assess severity, confirm scope.                    |
| **Status Update**       | Day 7     | Maintainer            | Send a written status update to the reporter.                           |
| **Fix Development**     | SLA Based | Maintainer            | Develop patch on a private branch; draft GitHub Security Advisory.      |
| **Fix Review**          | Pre-merge | Maintainer + Reporter | Internal review and testing. Reporter may be invited to verify the fix. |
| **Coordinated Release** | Day 60–90 | Maintainer            | Merge patch, tag release, publish GitHub Security Advisory.             |
| **Public Disclosure**   | Day 90    | Maintainer            | Publish full details. Credit reporter (with their consent).             |

## 4. Third-Party Dependency Vulnerabilities

If a vulnerability is found in a third-party dependency affecting this project:

1. **Verification**: We will assess if the vulnerable code path is actually reachable within our application.
2. **Upstream Coordination**: If the vulnerability is not yet known to the upstream maintainers, we will coordinate disclosure with them following their security policy.
3. **Mitigation**: If an upstream fix is not immediately available, we will attempt to implement a workaround or mitigation within our project (within the SLA windows above).
4. **Disclosure**: We will wait for the upstream maintainer to publish their advisory before we disclose our own mitigation or update, unless a critical actively exploited zero-day requires immediate action.

## 5. Emergency Track

For vulnerabilities that are **critical severity (CVSS ≥ 9.0)** or are being **actively exploited in the wild**, we reserve the right to release a patch ahead of the 90-day schedule. We will notify the reporter before doing so and coordinate timing where possible.
