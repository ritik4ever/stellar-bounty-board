# GitHub Webhook Security Implementation Guide

> [!NOTE]
> **Document Status:** Verified & Synchronized with Current Implementation  
> **Last Verified Date:** October 18, 2026  
> **Reference Commit:** `1f837a2` (Issue #1394)  
> **Verified Modules:** `backend/src/webhooks/signatureVerification.ts`, `backend/src/validation/webhookSecretValidation.ts`, `backend/src/webhooks/githubPrHandler.ts`  
> **Test Coverage:** `backend/test/webhookSecretValidation.test.ts`, `backend/test/webhookSignature.test.ts`, `backend/test/webhooks.comprehensive.test.ts`


- [Executive Summary](#executive-summary)
- [Security Architecture](#security-architecture)
- [Environment Configuration](#environment-configuration)
  - [Production Environment](#production-environment)
  - [Development Environment](#development-environment)
- [Secret Generation and Management](#secret-generation-and-management)
  - [Generating a Secure Secret](#generating-a-secure-secret)
  - [Storing the Secret](#storing-the-secret)
  - [Rotating the Secret](#rotating-the-secret)
- [Webhook Verification Flow](#webhook-verification-flow)
  - [Valid Webhook Request](#valid-webhook-request)
  - [Invalid Webhook Request (Attacker)](#invalid-webhook-request-attacker)
- [Error Scenarios and Solutions](#error-scenarios-and-solutions)
- [Testing Webhook Signatures](#testing-webhook-signatures)
  - [Manual Testing with curl](#manual-testing-with-curl)
  - [Complete Worked Example: End-to-End Delivery Simulation & Verification](#complete-worked-example-end-to-end-delivery-simulation--verification)
  - [Testing with GitHub Webhook Delivery](#testing-with-github-webhook-delivery)
  - [Unit Tests](#unit-tests)
- [Monitoring and Alerts](#monitoring-and-alerts)
- [Security Checklist](#security-checklist)
- [Quick Reference](#quick-reference)
- [See Also / Related Documentation](#see-also--related-documentation)
- [Additional Resources](#additional-resources)
- [Wave & Backlog Alignment](#wave--backlog-alignment)
- [Support](#support)

---


## Executive Summary

This guide explains the GitHub webhook security implementation for the Stellar Bounty Board. The system validates that webhook signatures are properly verified, preventing attackers from sending fake GitHub events.

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Application Startup                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Load environment variables (.env)                          │
│  2. Import Express app                                         │
│  3. ✓ VALIDATE GITHUB_WEBHOOK_SECRET ← NEW SECURITY CHECK     │
│  4. Start listening on port                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              Incoming Webhook Request                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  POST /api/webhooks/github                                     │
│  Headers:                                                       │
│    x-hub-signature-256: sha256=abc123...                       │
│    x-hub-delivery: 12345-67890                                 │
│  Body: { action: "opened", pull_request: {...} }              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Signature Verification Middleware                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Extract x-hub-signature-256 header                         │
│  2. Get GITHUB_WEBHOOK_SECRET from environment                 │
│  3. Compute HMAC-SHA256(payload, secret)                       │
│  4. Compare with timing-safe equality                          │
│                                                                 │
│  ✓ Valid   → Continue to handler                              │
│  ✗ Invalid → Return 401 Unauthorized                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              Webhook Event Handler                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Process GitHub event (PR merged, etc.)                        │
│  Update bounty status                                          │
│  Return 202 Accepted                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Environment Configuration

### Production Environment

```bash
# Set these environment variables before starting
export NODE_ENV=production
export GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 20)

# Start application
npm start

# Expected output:
# [INFO] server_listen { port: 3001 }
```

**Behavior:**
- ✅ Application starts successfully
- ✅ Webhook signatures are verified
- ❌ Application refuses to start if secret is missing

### Development Environment

```bash
# Option 1: With webhook testing
export NODE_ENV=development
export GITHUB_WEBHOOK_SECRET=test-secret-123
npm run dev

# Option 2: Without webhook testing (default)
export NODE_ENV=development
npm run dev

# Expected output:
# [WARN] startup_validation_warning { reason: "missing_github_webhook_secret" }
# [INFO] server_listen { port: 3001 }
```

**Behavior:**
- ✅ Application starts successfully
- ⚠️ Warning logged if secret is missing
- ⚠️ Webhook signatures are NOT verified (development only)

## Secret Generation and Management

### Generating a Secure Secret

```bash
# Generate a 40-character hex string (recommended)
openssl rand -hex 20

# Example output:
# a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0

# Alternative: Generate base64 string
openssl rand -base64 30
```

### Storing the Secret

**❌ DO NOT:**
```bash
# Don't hardcode in code
const secret = "abc123...";

# Don't commit to git
git add .env

# Don't share in chat/email
```

**✅ DO:**
```bash
# Use environment variables
export GITHUB_WEBHOOK_SECRET=...

# Use secrets manager
AWS Secrets Manager
HashiCorp Vault
GitHub Secrets (for CI/CD)

# Use .env file (with .gitignore)
echo "GITHUB_WEBHOOK_SECRET=..." > .env
echo ".env" >> .gitignore
```

### Rotating the Secret

**Step 1: Generate new secret**
```bash
NEW_SECRET=$(openssl rand -hex 20)
echo "New secret: $NEW_SECRET"
```

**Step 2: Update GitHub webhook settings**
- Go to repository Settings → Webhooks
- Edit the webhook
- Update the secret field
- Save

**Step 3: Update application environment**
```bash
export GITHUB_WEBHOOK_SECRET=$NEW_SECRET
# Restart application (no downtime required)
```

**Step 4: Verify**
- Check application logs for successful startup
- Send test webhook from GitHub
- Verify webhook is processed successfully

## Webhook Verification Flow

### Valid Webhook Request

```
GitHub Server                          Your Application
     │                                        │
     │ POST /api/webhooks/github              │
     │ x-hub-signature-256: sha256=abc123...  │
     │ Body: {...}                            │
     ├───────────────────────────────────────>│
     │                                        │
     │                    Verify signature:   │
     │                    1. Extract header   │
     │                    2. Compute HMAC     │
     │                    3. Compare          │
     │                    ✓ Match!            │
     │                                        │
     │                    Process event       │
     │                    Update bounty       │
     │                                        │
     │<─────────────────────────────────────  │
     │ 202 Accepted                           │
     │
```

### Invalid Webhook Request (Attacker)

```
Attacker                               Your Application
     │                                        │
     │ POST /api/webhooks/github              │
     │ x-hub-signature-256: sha256=fake...    │
     │ Body: {...}                            │
     ├───────────────────────────────────────>│
     │                                        │
     │                    Verify signature:   │
     │                    1. Extract header   │
     │                    2. Compute HMAC     │
     │                    3. Compare          │
     │                    ✗ No match!         │
     │                                        │
     │                    Reject request      │
     │                                        │
     │<─────────────────────────────────────  │
     │ 401 Unauthorized                       │
     │
```

## Error Scenarios and Solutions

### Scenario 1: Production Startup Without Secret

```bash
$ NODE_ENV=production npm start

Error: GITHUB_WEBHOOK_SECRET environment variable is not configured.
This is required to verify GitHub webhook signatures and prevent 
unauthorized webhook events. Set GITHUB_WEBHOOK_SECRET to a secure 
random string (e.g., openssl rand -hex 20).

Exit code: 1
```

**Solution:**
```bash
# Generate and set secret
export GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 20)
npm start
```

### Scenario 2: Webhook Returns 401 Unauthorized

**Cause:** Signature verification failed

**Debugging Steps:**
```bash
# 1. Check application logs
tail -f logs/app.log | grep "webhook"

# 2. Check GitHub webhook delivery logs
# Go to: Settings → Webhooks → Recent Deliveries

# 3. Verify secret matches
echo $GITHUB_WEBHOOK_SECRET

# 4. Check GitHub webhook settings
# Settings → Webhooks → Edit → Verify secret field matches
```

**Common Causes:**
- Secret mismatch between GitHub and application
- Secret changed but application not restarted
- Webhook payload modified in transit
- Timing issue (webhook timestamp too old)

### Scenario 3: Webhook Returns 500 Internal Server Error

**Cause:** Secret not configured at runtime

**Solution:**
```bash
# Verify environment variable is set
echo $GITHUB_WEBHOOK_SECRET

# If empty, set it
export GITHUB_WEBHOOK_SECRET=...

# Restart application
npm start
```

## Testing Webhook Signatures

### Manual Testing with curl

```bash
# 1. Generate test payload
PAYLOAD='{"action":"opened","pull_request":{"number":1}}'

# 2. Compute signature
SECRET="test-secret-123"
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | cut -d' ' -f2)

# 3. Send request
curl -X POST http://localhost:3001/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=$SIGNATURE" \
  -d "$PAYLOAD"

# Expected response: 202 Accepted
```

### Complete Worked Example: End-to-End Delivery Simulation & Verification

This worked walkthrough demonstrates how to compute an HMAC-SHA256 signature for a mock payload, dispatch the webhook request to a local server, and observe real execution output.

1. **Start the local server with webhook enforcement enabled:**
   ```bash
   export NODE_ENV=production
   export GITHUB_WEBHOOK_SECRET=4f9c2d1e0a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d
   npm start
   ```
   *Expected output:*
   ```text
   [INFO] startup_validation_passed { security: "github_webhook_secret_enforced" }
   [INFO] server_listen { port: 3001, env: "production" }
   ```

2. **Construct payload and calculate HMAC-SHA256 signature:**
   ```bash
   PAYLOAD='{"action":"closed","pull_request":{"id":98765,"merged":true,"merged_at":"2026-09-28T01:30:00Z","title":"fix: resolve payout panic"}}'
   SECRET="4f9c2d1e0a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d"
   SIGNATURE=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
   echo "Computed Signature: $SIGNATURE"
   ```
   *Expected output:*
   ```text
   Computed Signature: 8d2b3c4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c
   ```

3. **Dispatch request with signature header:**
   ```bash
   curl -i -X POST http://localhost:3001/api/webhooks/github \
     -H "Content-Type: application/json" \
     -H "x-hub-signature-256: sha256=$SIGNATURE" \
     -H "x-hub-delivery: 550e8400-e29b-41d4-a716-446655440000" \
     -d "$PAYLOAD"
   ```
   *Expected output:*
   ```http
   HTTP/1.1 202 Accepted
   Content-Type: application/json; charset=utf-8

   {"received":true,"status":"queued"}
   ```

4. **Negative Test: Dispatching request with an invalid/tampered signature:**
   ```bash
   curl -i -X POST http://localhost:3001/api/webhooks/github \
     -H "Content-Type: application/json" \
     -H "x-hub-signature-256: sha256=0000000000000000000000000000000000000000000000000000000000000000" \
     -d "$PAYLOAD"
   ```
   *Expected output:*
   ```http
   HTTP/1.1 401 Unauthorized
   Content-Type: application/json; charset=utf-8

   {"error":"Unauthorized","message":"Invalid GitHub webhook signature"}
   ```


### Testing with GitHub Webhook Delivery

```bash
# 1. Go to repository Settings → Webhooks
# 2. Click on webhook
# 3. Scroll to "Recent Deliveries"
# 4. Click "Redeliver" on a previous delivery
# 5. Check response status (should be 202)
```

### Unit Tests & Verification Suites

The repository contains three targeted test suites covering webhook security:

```bash
# 1. Startup validation (enforcement of GITHUB_WEBHOOK_SECRET)
npm --prefix backend test -- backend/test/webhookSecretValidation.test.ts

# 2. Signature verification, algorithm negotiation & secret rotation
npm --prefix backend test -- backend/test/webhookSignature.test.ts

# 3. Comprehensive end-to-end webhook delivery & error handling
npm --prefix backend test -- backend/test/webhooks.comprehensive.test.ts

# Run all backend tests
npm test
```

#### Key Implementation Modules
- **Startup Guard:** `backend/src/validation/webhookSecretValidation.ts` (`validateGitHubWebhookSecret`)
- **HMAC Verification & Rotation:** `backend/src/webhooks/signatureVerification.ts` (`verifyWebhookSignature`, `verifyGitHubWebhookSignatureWithNegotiation`, `verifyWithSecretRotation`)
- **Delivery Deduplication:** `backend/src/webhooks/deliveryDedup.ts`
- **PR Event Handler:** `backend/src/webhooks/githubPrHandler.ts`

## Monitoring and Alerts

### What to Monitor

```
1. Webhook Signature Verification Failures
   - Log: "Invalid GitHub webhook signature"
   - Alert if: > 5 failures in 5 minutes

2. Missing Secret on Startup
   - Log: "startup_validation_failed"
   - Alert: Always (critical)

3. Webhook Processing Errors
   - Log: "github_webhook_error"
   - Alert if: > 10 errors in 1 hour

4. Webhook Delivery Latency
   - Log: "github_webhook_processed"
   - Alert if: > 5 seconds
```

### Log Examples

**Successful Webhook:**
```json
{
  "level": "info",
  "event": "github_webhook_pr_auto_released",
  "bountyId": "BNT-0001",
  "prUrl": "https://github.com/owner/repo/pull/100"
}
```

**Failed Signature Verification:**
```json
{
  "level": "warn",
  "event": "webhook_signature_verification_failed",
  "reason": "Invalid GitHub webhook signature",
  "statusCode": 401
}
```

**Missing Secret on Startup:**
```json
{
  "level": "error",
  "event": "startup_validation_failed",
  "reason": "missing_github_webhook_secret",
  "environment": "production"
}
```

## Security Checklist

- [ ] Generate secure random secret: `openssl rand -hex 20`
- [ ] Set `GITHUB_WEBHOOK_SECRET` in production environment
- [ ] Set `NODE_ENV=production` in production
- [ ] Verify `.env` is in `.gitignore`
- [ ] Test startup with secret configured
- [ ] Test webhook signature verification
- [ ] Configure GitHub webhook with same secret
- [ ] Monitor webhook delivery logs
- [ ] Set up alerts for verification failures
- [ ] Document secret rotation procedure
- [ ] Plan secret rotation schedule (e.g., quarterly)
- [ ] Test secret rotation procedure

## Quick Reference

| Task | Command |
|------|---------|
| Generate secret | `openssl rand -hex 20` |
| Set environment variable | `export GITHUB_WEBHOOK_SECRET=...` |
| Start production | `NODE_ENV=production npm start` |
| Start development | `npm run dev` |
| Run tests | `npm test` |
| Run webhook tests | `npm test -- webhookSecretValidation.test.ts` |
| Check logs | `tail -f logs/app.log` |
| Verify secret is set | `echo $GITHUB_WEBHOOK_SECRET` |


## See Also / Related Documentation

- [WEBHOOK_SECRET_VALIDATION.md](./WEBHOOK_SECRET_VALIDATION.md) — Startup validation and enforcement of `GITHUB_WEBHOOK_SECRET`.
- [SECURITY.md](./SECURITY.md) — Security policies, vulnerability disclosure procedures, and CSP configurations.
- [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md) — Pre-PR security verification checklist for new endpoints and auth changes.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Contributor onboarding, local testing, and development guides.


## Additional Resources

- [GitHub Webhook Security Documentation](https://docs.github.com/en/developers/webhooks-and-events/webhooks/securing-your-webhooks)
- [Node.js Crypto Module](https://nodejs.org/api/crypto.html)
- [HMAC-SHA256 Verification](https://en.wikipedia.org/wiki/HMAC)
- [12 Factor App - Configuration](https://12factor.net/config)
- [OWASP - Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)


## Wave & Backlog Alignment

This security guide is integrated with the project's phased delivery roadmap across waves 4, 5, and 6:

- **Wave 4 ([docs/wave-4.md](docs/wave-4.md)) — Core Foundation & Schema Hardening:**
  - Implements API input validation and automated contract verification.
  - Aligns with GitHub PR webhook handlers for status transitions.
- **Wave 5 ([docs/wave-5.md](docs/wave-5.md)) — Security, Observability & Polish:**
  - Enforces `GITHUB_WEBHOOK_SECRET` validation on server startup (`WEBHOOK_SECRET_VALIDATION.md`).
  - Implements structured security audit logging and timing-safe signature verification.
- **Wave 6 ([docs/wave-6.md](docs/wave-6.md)) — Production Hardening & Integration:**
  - Automated webhook synchronization with persistent audit storage.
  - Secret rotation runbooks and multi-environment deployment gating.

### Canonical Contribution Process

When contributing webhook or security enhancements, follow the canonical workflow defined in [CONTRIBUTING.md](./CONTRIBUTING.md):
1. **Branching**: Create focused topic branches off `main` (e.g. `feat/webhook-...`, `fix/security-...`).
2. **Conventional Commits**: Format commit messages according to the repository standard (`feat(...)`, `fix(...)`, `docs(...)`).
3. **Local Testing**: Run `npm test` and pre-commit checks via Husky and lint-staged before opening a PR.
4. **Issue Linkage**: Reference the associated issue in your PR description (`Closes #<issue-id>`).

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review application logs
3. Check GitHub webhook delivery logs
4. Open an issue on GitHub with logs and environment details
