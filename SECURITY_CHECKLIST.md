# Security Review Checklist

This checklist is based on OWASP Top 10 inspired principles. When making a pull request, review the following items and ensure relevant files have been verified.

## Table of Contents

- [1. Input Validation Changed](#1-input-validation-changed)
- [2. Auth Modified](#2-auth-modified)
- [3. New External Fetch](#3-new-external-fetch)
- [4. Dependency Added](#4-dependency-added)
- [5. Secret Handling](#5-secret-handling)
- [6. Admin API Key Rotation Procedure](#6-admin-api-key-rotation-procedure)
  - [Worked Example: Exercising Admin API Key Rotation and Verification](#worked-example-exercising-admin-api-key-rotation-and-verification)
- [Wave & Backlog Alignment](#wave--backlog-alignment)
- [Wave 5 Issue Cross-Reference](#wave-5-issue-cross-reference)
- [See Also / Related Documentation](#see-also--related-documentation)

---

## 1. Input Validation Changed

Check for proper validation, sanitization, and typing of all inputs from users or external systems.
**Relevant Files:** Route handlers, controllers, data transfer objects (DTOs), API layer.

## 2. Auth Modified

Check that authentication and authorization logic correctly verifies user identity and permissions without bypassing checks.
**Relevant Files:** Middleware, authentication services, token handlers.

## 3. New External Fetch

Check that any new external API calls or webhook requests are made securely (HTTPS), handle timeouts appropriately, and do not leak sensitive information in URLs.
**Relevant Files:** Services, integrations, API clients.

## 4. Dependency Added

Check that new dependencies are necessary, reputable, and free from known vulnerabilities (e.g., via `npm audit`).
**Relevant Files:** `package.json`, `package-lock.json`.

## 5. Secret Handling

Check that no credentials, tokens, or private keys are hardcoded in the source code and that environment variables are securely handled.
**Relevant Files:** Configuration files, environment loaders, CI/CD workflows.

## 6. Admin API Key Rotation Procedure

Check that a documented, tested admin API key rotation procedure is established, using refresh-token rotation and API-key-scoping features as the implementation basis.
- **Rotation Cadence:** Rotate keys on a recommended schedule (e.g., quarterly) or immediately upon suspected compromise.
- **Invalidation & Verification:** Include explicit steps to verify that old, rotated-out keys are fully invalidated and confirmed rejected by the API.
- **Exercise Evidence:** Require concrete evidence (such as test output or execution logs) demonstrating that the rotation procedure was actually exercised and that a rotated-out key is confirmed rejected, rather than merely documented.
**Relevant Files:** Authentication services, API key management handlers, route controllers, security documentation.

### Worked Example: Exercising Admin API Key Rotation and Verification

When performing an Admin API Key rotation, follow this procedure with concrete curl verification commands:

1. **Generate and activate the replacement admin API key in `.env`:**
   ```bash
   # Generate secure 256-bit token
   openssl rand -hex 32
   ```
   *Expected output:*
   ```text
   7f8a9b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd
   ```

2. **Verify authentication with the new key:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" \
     -H "Authorization: Bearer 7f8a9b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd" \
     http://localhost:3000/api/admin/health
   ```
   *Expected output:*
   ```text
   200
   ```

3. **Verify rejection and revocation of the retired/previous key:**
   ```bash
   curl -s -i \
     -H "Authorization: Bearer old_revoked_key_here" \
     http://localhost:3000/api/admin/health
   ```
   *Expected output:*
   ```http
   HTTP/1.1 401 Unauthorized
   Content-Type: application/json; charset=utf-8

   {"error":"Unauthorized","message":"Invalid or revoked API credentials"}
   ```

---

## Wave & Backlog Alignment

This security checklist is the **authoritative source for security review criteria** across delivery waves. Update this file when adding, changing, or retiring a security review requirement. Wave documents remain authoritative for their respective backlogs and implementation progress; they link back here rather than maintaining a separate copy of the checklist.

- **Wave 4 ([docs/wave-4.md](docs/wave-4.md)) — Core API & Contract Foundation:** Item 1 (Input Validation Changed) and Item 2 (Auth Modified) are review gates for bounty lifecycle endpoints (`/reserve`, `/submit`, `/release`, `/refund`). See the wave document for planned work; do not infer completion from a cross-reference alone.
- **Wave 5 ([docs/wave-5.md](docs/wave-5.md)) — Security, Observability & Polish:** the 40-item backlog is mapped to checklist items in the [Wave 5 Issue Cross-Reference](#wave-5-issue-cross-reference) below. Direct mappings identify relevant review gates; related or unmapped items are explicitly called out.
- **Wave 6 ([docs/wave-6.md](docs/wave-6.md)) — Production Hardening & Integration:** review Item 3 (external fetches) and Item 4 (dependencies) when applicable before production database migration and Freighter wallet auth.

### Canonical Contribution Process

All pull requests modifying security-sensitive code must follow the single canonical process in [CONTRIBUTING.md](./CONTRIBUTING.md):
1. **Branch Hygiene**: Create dedicated topic branches off `main`.
2. **Review Checklist**: Review all 6 checklist items above before submitting your pull request.
3. **Evidence Requirement**: Include explicit test commands and output logs demonstrating both success and rejection behaviors where relevant.

---

## Wave 5 Issue Cross-Reference

This matrix covers every numbered item in [`docs/wave-5.md`](docs/wave-5.md). “Direct” means the issue explicitly touches a checklist control; “Related” means it may affect the control depending on implementation; “No direct match” means the issue is valuable but does not correspond to one of the six current checklist headings. These classifications describe review relevance, **not completion or verification status**.

| Wave 5 # | Issue (short title) | Checklist mapping | Relationship / review note |
| ---: | --- | --- | --- |
| 1 | React error boundary | No direct match | Error handling / resilience; not one of the six checklist controls. |
| 2 | BountyCard ARIA and keyboard navigation | No direct match | Accessibility work. |
| 3 | Skeleton loading state | No direct match | Frontend loading UX. |
| 4 | Toast notifications | No direct match | User feedback for actions. |
| 5 | `expiresAt` countdown | Related: 1 | Validate the expiry value and handle missing or malformed timestamps if sourced externally. |
| 6 | Empty-state illustration | No direct match | Frontend empty-state UX. |
| 7 | XLM → USD CoinGecko conversion | Direct: 3; Related: 4 | Secure external API fetches, timeout/error handling, and review any new client dependency. |
| 8 | Contributor profile link | Related: 2 | Check authorization and avoid exposing private profile data if access controls are involved. |
| 9 | Expiration-job configuration docs | Related: 5 | Document secret/config handling accurately; documentation alone does not verify secret safety. |
| 10 | Health endpoints | Related: 2, 5 | Ensure health responses do not expose credentials or protected operational details. |
| 11 | Prometheus `/metrics` endpoint | Related: 2, 5 | Check access controls and ensure metrics do not disclose secrets or sensitive data. |
| 12 | Full-text bounty search | Direct: 1 | Validate and safely handle the user-supplied `q` query. |
| 13 | Contributor leaderboard endpoint | Related: 1, 2 | Validate query parameters and ensure only intended data is exposed. |
| 14 | Per-IP rate limiting | Related: 2 | Review placement and bypass resistance alongside authentication/authorization changes. |
| 15 | `X-Request-ID` propagation | Related: 1, 5 | Treat supplied IDs as untrusted input; do not place secrets or personal data in IDs/logs. |
| 16 | Concurrent reservation integration test | Related: 1, 2 | Exercise validation and authorization invariants under race conditions where applicable. |
| 17 | JSON store to PostgreSQL (SQLite/Drizzle retired, see ADR 0004) | Direct: 4 | Review new dependencies and migration tooling for necessity and known vulnerabilities. |
| 18 | `BOUNTY_STORE_PATH` configuration | Related: 1, 5 | Validate the configured path and keep deployment secrets out of configuration/log output. |
| 19 | Graceful shutdown / stop expiration job | No direct match | Lifecycle and reliability work. |
| 20 | Zod validation for expiration settings | Direct: 1 | Validate environment values and reject invalid configuration at startup. |
| 21 | On-chain deadline enforcement | Related: 1, 2 | Validate deadline inputs and enforce authorized state transitions in contract logic. |
| 22 | `dispute_bounty` / arbiter resolution | Related: 2 | Review arbiter authorization and ensure only permitted actors can resolve disputes. |
| 23 | Contract state-transition events | Related: 5 | Ensure emitted event data does not contain secrets; events are generally public. |
| 24 | Fuzz invalid state transitions | Related: 1, 2 | Test invalid inputs and unauthorized/invalid transitions. |
| 25 | Refund after deadline test | Related: 1, 2 | Verify deadline validation and authorization for refunds. |
| 26 | Upgrade `soroban-sdk` | Direct: 4 | Review the dependency version and scan for known vulnerabilities/deprecations. |
| 27 | Expiration-job config options doc | Related: 5 | Keep documented configuration and secret-handling guidance accurate. |
| 28 | Security disclosure timeline | Related: 2, 5, 6 | Ensure reporting guidance avoids requesting secrets and aligns with incident/key-rotation procedures. |
| 29 | Bounty lifecycle sequence diagram | Related: 1, 2 | Diagrams should accurately show validation and authorization boundaries. |
| 30 | On-chain vs off-chain ownership table | Related: 2, 5 | Clarify protected data boundaries and avoid implying secrets belong on-chain. |
| 31 | Environment-variable reference | Related: 1, 5 | Identify sensitive variables and document validation without publishing secret values. |
| 32 | Railway deployment guide | Related: 5 | Explain secure environment-variable/secret configuration and avoid committing credentials. |
| 33 | Video walkthrough and visual overview | No direct match | Contributor onboarding; review media for accidental disclosure if it shows real credentials. |
| 34 | ngrok webhook testing guide | Direct: 3; Related: 1, 5 | Explain secure webhook testing, request validation, HTTPS, and safe secret handling. |
| 35 | Conventional commits cheatsheet | No direct match | Contribution-process documentation. |
| 36 | `docs/issues/` index | No direct match | Documentation discoverability. |
| 37 | `gitleaks` CI step | Direct: 5 | Detect committed secrets; document handling of findings and false positives. |
| 38 | Docker healthcheck instruction | Related: 5 | Ensure healthcheck configuration does not embed or reveal credentials. |
| 39 | Automated GitHub release workflow | Related: 4, 5 | Review workflow dependencies, permissions, and release-token/secret exposure. |
| 40 | `CODEOWNERS` for sensitive paths | Related: 2, 5 | Supports review governance for authentication and secret-sensitive changes; it does not replace runtime controls. |

### Checklist coverage gaps identified

- **Direct checklist coverage exists** for Wave 5 items #7, #12, #17, #20, #26, #34, and #37.
- **Related review coverage** is called out above for items that may touch input validation, authorization, external fetches, dependencies, or secrets depending on implementation.
- **No direct checklist equivalent** is recorded for the remaining UX, reliability, and contributor-documentation work. Those issues remain in the Wave 5 backlog; they are not security-checklist failures simply because the checklist is security-focused.
- **Checklist capability not represented as a dedicated Wave 5 issue:** Item 6 (admin API key rotation) is named in the security checklist but has no dedicated issue in the 40-item Wave 5 list. Keep the checklist procedure authoritative; if the rotation procedure itself needs implementation or exercise evidence, track that work as a separate backlog issue rather than implying another Wave 5 issue completes it.

Do not check off a review criterion solely because a Wave 5 issue references it. Mark it verified only after reviewing the implementation and required evidence.

---

## See Also / Related Documentation

- [`SECURITY.md`](./SECURITY.md) — Comprehensive Security Policy, reporting instructions, and CSP configurations.
- [`WEBHOOK_SECURITY_GUIDE.md`](./WEBHOOK_SECURITY_GUIDE.md) — Webhook signature verification and threat mitigation guide.
- [`WEBHOOK_SECRET_VALIDATION.md`](./WEBHOOK_SECRET_VALIDATION.md) — Environment variable startup validation and secret management.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Contributor checklist, conventional commits, and local test requirements.

<!-- Verified: 2026-10-22 — Wave 5 issues cross-referenced with this checklist; mapping indicates relevance, not completion. -->
