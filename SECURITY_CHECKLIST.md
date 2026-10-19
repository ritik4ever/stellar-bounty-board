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

This security checklist serves as the quality gate across all delivery milestones in waves 4, 5, and 6:

- **Wave 4 ([docs/wave-4.md](docs/wave-4.md)) — Core API & Contract Foundation:**
  - Enforces Item 1 (Input Validation Changed) and Item 2 (Auth Modified) on all bounty lifecycle endpoints (`/reserve`, `/submit`, `/release`, `/refund`).
- **Wave 5 ([docs/wave-5.md](docs/wave-5.md)) — Security, Observability & Polish:**
  - Enforces Item 5 (Secret Handling) and Item 6 (Admin API Key Rotation Procedure) with verified rejection proof.
- **Wave 6 ([docs/wave-6.md](docs/wave-6.md)) — Production Hardening & Integration:**
  - Governs external fetch auditing (Item 3) and dependency additions (Item 4) prior to production database migration and Freighter wallet auth.

### Canonical Contribution Process

All pull requests modifying security-sensitive code must follow the single canonical process in [CONTRIBUTING.md](./CONTRIBUTING.md):
1. **Branch Hygiene**: Create dedicated topic branches off `main`.
2. **Review Checklist**: Review all 6 checklist items above before submitting your pull request.
3. **Evidence Requirement**: Include explicit test commands and output logs demonstrating both success and rejection behaviors.


## See Also / Related Documentation

- [SECURITY.md](./SECURITY.md) — Comprehensive Security Policy, reporting instructions, and CSP configurations.
- [WEBHOOK_SECURITY_GUIDE.md](./WEBHOOK_SECURITY_GUIDE.md) — Webhook signature verification and threat mitigation guide.
- [WEBHOOK_SECRET_VALIDATION.md](./WEBHOOK_SECRET_VALIDATION.md) — Environment variable startup validation and secret management.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Contributor checklist, conventional commits, and local test requirements.


<!-- Verified: 2026-10-01 — all referenced files exist + checks match current codebase (per issue #1384) -->
