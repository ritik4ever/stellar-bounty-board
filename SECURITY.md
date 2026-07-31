# Security Policy

## Content Security Policy (CSP)

The frontend build injects a `Content-Security-Policy-Report-Only` meta tag via `frontend/vite.config.ts`.

### Current policy

```
default-src 'self';
connect-src 'self' https://rpc-futurenet.stellar.org https://api.github.com;
script-src  'self';
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob:;
font-src    'self';
object-src  'none';
base-uri    'self';
form-action 'self';
```

### Report-only mode

The policy is currently deployed in **report-only mode** (`Content-Security-Policy-Report-Only`).
Violations are logged to the browser console but do **not** block any functionality.
Once no violations are observed in staging, the meta tag should be upgraded to
`Content-Security-Policy` to enforce the policy.

### Updating the policy

Edit the `cspDirectives` array in `frontend/vite.config.ts` → `cspPlugin()`.
After any change, verify there are no new console violations before promoting to production.

---

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

## Authentication Architecture

The maintainer API routes are protected by Stellar keypair signature verification rather than JWT or session tokens. See [ADR 0002 — Stellar Signature Authentication](docs/adr/0002-stellar-signature-auth.md) for the rationale, verification flow, multi-key support, and replay attack considerations.

---

## Contract Security Review: Arbiter Trust Assumptions

**⚠️ CRITICAL:** This section documents the security assumptions and failure modes related to the single arbiter address in the escrow contract. **Review this section whenever the dispute-resolution contract logic changes.**

### Current Trust Assumptions

The Stellar Bounty Board contract (`contracts/src/lib.rs`) currently places **significant trust** in a single arbiter address:

1. **Dispute Initiation Authority**: The arbiter is the only entity that can initiate a dispute on a submitted bounty (`dispute_bounty` function). This requires the arbiter's signature authorization.

2. **Final Dispute Resolution**: The arbiter has unilateral authority to resolve disputes (`resolve_dispute` function), deciding whether funds are released to the contributor or refunded to the maintainer. This decision is final and irreversible.

3. **No Time Constraints on Resolution**: While there is a dispute window that must pass before resolution, once the window expires, the arbiter can resolve at any time without additional constraints.

4. **Single Point of Control**: The arbiter address is set once during contract initialization and cannot be changed without redeploying the entire contract.

5. **No Oversight Mechanisms**: There are no committee voting, multi-signature requirements, or slashing/bonding mechanisms to constrain arbiter behavior.

### Failure Modes

#### 1. Arbiter Key Compromise

**Scenario**: The arbiter's private key is stolen or leaked.

**Impact**:
- Attacker can dispute any submitted bounty, forcing it into disputed status
- Attacker can resolve all disputed bounties maliciously (stealing funds or denying legitimate payouts)
- No mechanism to revoke arbiter authority without full contract redeployment
- All disputed bounties are immediately vulnerable

**Current Mitigation**: Contract redeployment with new arbiter (see [RUNBOOK.md - Incident Response: Compromised Arbiter Key](./RUNBOOK.md#incident-response-compromised-arbiter-key))

**Severity**: CRITICAL

#### 2. Arbiter Key Loss

**Scenario**: The arbiter loses access to their private key (device failure, death, incapacity).

**Impact**:
- Disputed bounties cannot be resolved, leaving funds permanently locked in the contract
- New disputes cannot be initiated (though this is less critical)
- No recovery mechanism without contract redeployment
- Contributors with disputed bounties cannot receive funds
- Maintainers with disputed bounties cannot receive refunds

**Current Mitigation**: Contract redeployment with new arbiter (requires migrating all active bounties)

**Severity**: HIGH

#### 3. Malicious Arbiter Behavior

**Scenario**: The arbiter acts in bad faith (bribery, collusion, arbitrary decisions).

**Impact**:
- Arbiter can selectively resolve disputes to favor certain parties
- No mechanism to appeal or reverse arbiter decisions
- Arbiter can extort maintainers/contributors by threatening adverse resolutions
- Reputation damage to the bounty board platform
- Loss of user trust in the dispute resolution system

**Current Mitigation**: None (relies on social reputation and legal recourse)

**Severity**: HIGH

#### 4. Arbiter Unavailability

**Scenario**: The arbiter is temporarily unavailable (vacation, illness, technical issues).

**Impact**:
- Disputed bounties remain unresolved for extended periods
- Contributors experience delayed payments
- Maintainers experience delayed refunds
- Dispute window may expire but resolution still requires arbiter action

**Current Mitigation**: None (relies on arbiter availability)

**Severity**: MEDIUM

#### 5. Arbiter Front-Running

**Scenario**: The arbiter observes pending transactions and acts on information before transactions complete.

**Impact**:
- Arbiter could dispute bounties immediately before maintainer cancellation to capture fees
- Timing attacks on dispute resolution to maximize personal gain
- Information asymmetry exploitation

**Current Mitigation**: Limited (dispute window provides some protection)

**Severity**: MEDIUM

### Proposed Mitigations (Not Yet Implemented)

The following features have been proposed to address these failure modes but are **not currently implemented** in the contract:

#### 1. Arbiter Rotation with Timelock

**Status**: ❌ Not Implemented

**Description**: Allow the arbiter address to be changed with a timelock delay, enabling recovery from key compromise without full contract redeployment.

**Implementation Reference**: See proposed code in [RUNBOOK.md - Future Improvements](./RUNBOOK.md#future-improvements)

**Addresses**: Key compromise, key loss

**Tracking**: [GitHub Issue #XXX] (placeholder - create issue to track)

#### 2. Emergency Pause Function

**Status**: ❌ Not Implemented

**Description**: Add an emergency pause function callable by admin or timelock-protected multi-sig to halt all contract operations during security incidents.

**Implementation Reference**: See proposed code in [RUNBOOK.md - Future Improvements](./RUNBOOK.md#future-improvements)

**Addresses**: Key compromise, malicious behavior

**Tracking**: [GitHub Issue #XXX] (placeholder - create issue to track)

#### 3. Committee-Based Dispute Resolution

**Status**: ❌ Not Implemented

**Description**: Replace single arbiter with a committee requiring majority vote for dispute resolution, reducing single point of failure and collusion risk.

**Addresses**: Malicious behavior, unavailability

**Tracking**: [GitHub Issue #XXX] (placeholder - create issue to track)

#### 4. Arbiter Bonding and Slashing

**Status**: ❌ Not Implemented

**Description**: Require arbiter to stake tokens that can be slashed for malicious behavior or proven collusion, creating economic disincentives for bad actors.

**Addresses**: Malicious behavior, front-running

**Tracking**: [GitHub Issue #XXX] (placeholder - create issue to track)

#### 5. Multi-Signature Protection

**Status**: ❌ Not Implemented

**Description**: Require multiple signatures for critical arbiter operations, reducing single point of failure risk.

**Addresses**: Key compromise, key loss, malicious behavior

**Tracking**: [GitHub Issue #XXX] (placeholder - create issue to track)

### Security Review Checklist

**When reviewing changes to dispute-resolution logic, verify:**

- [ ] Does the change increase arbiter authority? If so, document the new trust assumption.
- [ ] Does the change add any mitigation for existing failure modes?
- [ ] Are there new attack vectors introduced by the change?
- [ ] Is the arbiter key storage mechanism documented and secure?
- [ ] Is there a recovery path if the arbiter key is lost?
- [ ] Is there a containment plan if the arbiter key is compromised?
- [ ] Does the change affect the dispute window timing? Verify security implications.
- [ ] Are there new events or logs that could help detect arbiter misconduct?
- [ ] Does the change require updating this security section?

### Operational Security Recommendations

**For Current Deployment:**

1. **Hardware Wallet Storage**: Store the arbiter private key on a hardware wallet (e.g., Ledger, Trezor) rather than a software wallet or file.

2. **Key Generation Ceremony**: Generate the arbiter keypair using a secure, air-gapped process with multiple witnesses.

3. **Backup Procedure**: Create secure, distributed backups of the arbiter key (e.g., Shamir's Secret Sharing) to prevent loss.

4. **Regular Rotation**: Schedule quarterly arbiter key rotation even if no compromise is suspected (requires contract redeployment).

5. **Monitoring**: Implement monitoring for all arbiter transactions to detect suspicious activity early.

6. **Legal Framework**: Establish a legal agreement with the arbiter outlining responsibilities, liabilities, and dispute resolution procedures.

7. **Transparency**: Publicly document the arbiter identity/organization to enable social accountability.

8. **Incident Response**: Maintain an updated incident response plan (see [RUNBOOK.md](./RUNBOOK.md#incident-response-compromised-arbiter-key)).

### Risk Assessment Summary

| Failure Mode | Likelihood | Impact | Current Mitigation | Priority |
|-------------|------------|--------|-------------------|----------|
| Key Compromise | Medium | Critical | Contract redeployment | HIGH |
| Key Loss | Low | High | Contract redeployment | MEDIUM |
| Malicious Behavior | Low | High | None (social/legal) | HIGH |
| Unavailability | Medium | Medium | None | LOW |
| Front-Running | Low | Medium | Dispute window | LOW |

**Overall Risk Level**: HIGH - Due to single point of failure and lack of implemented mitigations.

**Recommendation**: Prioritize implementation of arbiter rotation and emergency pause functions to reduce critical risk.

---

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
