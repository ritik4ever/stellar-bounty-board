# Update SECURITY.md With Full Responsible Disclosure Timeline

Labels: `documentation`, `security`, `good first issue`

## Summary

`SECURITY.md` currently describes the 90-day disclosure window at a high level but lacks a
step-by-step timeline that reporters and maintainers can follow. This issue asks for a concrete,
dated-phase breakdown so both sides know exactly what to expect after a report is filed.

## Why It Matters

- Reporters need confidence that their finding will be acted on — a clear timeline builds trust.
- Maintainers need a shared checklist to avoid missing SLA milestones.
- A published timeline is a prerequisite for responsible-disclosure badge programmes (e.g., HackerOne, Bugcrowd).
- It aligns the project with industry norms (Google Project Zero 90-day policy, CERT/CC guidelines).

## Proposed Disclosure Timeline

| Phase                   | Day       | Action                                                                                      |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------- |
| **Receipt**             | Day 0     | Reporter submits via private email or GitHub private reporting.                             |
| **Acknowledgement**     | Day 0–2   | Maintainer acknowledges receipt and assigns a tracking ID.                                  |
| **Triage**              | Day 2–7   | Maintainer reproduces the issue, assesses severity (CVSS), and confirms scope.              |
| **Status Update**       | Day 7     | Maintainer sends a written status update to the reporter.                                   |
| **Fix Development**     | Day 7–45  | Patch developed on a private branch; draft advisory prepared.                               |
| **Fix Review**          | Day 45–60 | Internal review, testing, and sign-off. Reporter may be invited to verify the fix.          |
| **Coordinated Release** | Day 60–90 | Patch merged, release tagged, GitHub Security Advisory published.                           |
| **Public Disclosure**   | Day 90    | Full details published. Reporter credited (with consent).                                   |
| **Emergency Track**     | Any       | Critical/actively-exploited issues may be released ahead of schedule with reporter consent. |

> **Note:** The 90-day window may be extended by mutual agreement (e.g., complex supply-chain
> issues). It may be shortened for critical vulnerabilities being actively exploited in the wild.

## Acceptance Criteria

- [ ] `SECURITY.md` contains the full phase table above.
- [ ] Each phase includes the responsible party (reporter vs. maintainer).
- [ ] An **Emergency Track** clause is documented for critical/zero-day issues.
- [ ] A **Credits** section explains how reporters are acknowledged.
- [ ] The private reporting channel (email or GitHub private reporting URL) is clearly stated.
- [ ] The document references the existing CodeQL automated scanning workflow.
- [ ] No code changes are required — this is a pure documentation task.

## Files to Edit

- `SECURITY.md`

## Getting Started

```bash
# Read the current policy first
cat SECURITY.md

# Then open for editing
code SECURITY.md
```

## Related

- Wave 4 issue #51 — Add security vulnerability disclosure issue template (merged)
- `.github/workflows/codeql.yml` — automated security scanning already in place
- `docs/issues/security-disclosure.md` — the reporter-facing issue template
