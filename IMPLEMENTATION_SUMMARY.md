# GitHub Webhook Secret Validation - Implementation Summary

## Quick Overview

This implementation adds startup validation for `GITHUB_WEBHOOK_SECRET` to prevent unauthorized webhook events. The solution is production-safe, development-friendly, and fully tested.

## File Structure

```
stellar-bounty-board/
├── backend/
│   ├── src/
│   │   ├── index.ts                          [MODIFIED] - Added validation call
│   │   ├── app.ts                            [UNCHANGED] - Webhook route already uses secret
│   │   ├── validation/
│   │   │   ├── webhookSecretValidation.ts    [NEW] - Validation logic
│   │   │   └── schemas.ts                    [UNCHANGED]
│   │   └── webhooks/
│   │       └── signatureVerification.ts      [UNCHANGED] - Signature verification
│   └── test/
│       └── webhookSecretValidation.test.ts   [NEW] - 13 comprehensive tests
├── .env.example                              [MODIFIED] - Enhanced documentation
└── WEBHOOK_SECRET_VALIDATION.md              [NEW] - Full documentation
```

## Code Changes

### 1. New Validation Module

**File:** `backend/src/validation/webhookSecretValidation.ts`

```typescript
export function validateGitHubWebhookSecret(): void {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";

  if (!secret || secret.trim() === "") {
    const errorMessage = "GITHUB_WEBHOOK_SECRET environment variable is not configured...";
    
    if (isProduction) {
      logStructured("error", "startup_validation_failed", {...});
      throw new Error(errorMessage);
    } else {
      logStructured("warn", "startup_validation_warning", {...});
    }
  }
}
```

**Key Features:**
- Checks if secret is missing or empty
- Different behavior for production vs development
- Clear, actionable error messages
- Structured logging for consistency

### 2. Startup Integration

**File:** `backend/src/index.ts`

```typescript
import { validateGitHubWebhookSecret } from "./validation/webhookSecretValidation";

// Validate critical environment variables before starting the server
validateGitHubWebhookSecret();

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  logStructured("info", "server_listen", { port });
});
```

**Execution Order:**
1. Load environment variables (dotenv)
2. Import app module
3. **Validate webhook secret** ← NEW
4. Start listening on port

### 3. Environment Documentation

**File:** `.env.example`

```dotenv
# [REQUIRED] Secret used to verify signatures for GitHub Webhooks.
# This is critical for security - it prevents attackers from sending fake webhook events.
# Generate a random string: openssl rand -hex 20
# In production, this MUST be set or the application will refuse to start.
# In development, a warning is logged if missing, but the app continues.
GITHUB_WEBHOOK_SECRET=your_github_webhook_secret_here
```

### 4. Comprehensive Tests

**File:** `backend/test/webhookSecretValidation.test.ts`

```typescript
describe("validateGitHubWebhookSecret", () => {
  describe("Production environment", () => {
    it("should throw error when GITHUB_WEBHOOK_SECRET is missing")
    it("should throw error when GITHUB_WEBHOOK_SECRET is empty string")
    it("should throw error when GITHUB_WEBHOOK_SECRET is only whitespace")
    it("should not throw when GITHUB_WEBHOOK_SECRET is set")
    it("should include actionable guidance in error message")
  })

  describe("Development environment", () => {
    it("should not throw when GITHUB_WEBHOOK_SECRET is missing")
    it("should not throw when GITHUB_WEBHOOK_SECRET is empty string")
    it("should not throw when GITHUB_WEBHOOK_SECRET is only whitespace")
    it("should not throw when GITHUB_WEBHOOK_SECRET is set")
  })

  describe("Default environment", () => {
    it("should treat missing NODE_ENV as development and not throw")
  })

  describe("Edge cases", () => {
    it("should handle NODE_ENV with different casings")
    it("should accept secrets with special characters")
    it("should accept very long secrets")
  })
})
```

**Test Results:** ✅ 13/13 passing

## How It Works

### Scenario 1: Production with Missing Secret

```bash
$ NODE_ENV=production npm start
# Error: GITHUB_WEBHOOK_SECRET environment variable is not configured...
# Exit code: 1
```

**Structured Log:**
```json
{
  "level": "error",
  "event": "startup_validation_failed",
  "reason": "missing_github_webhook_secret",
  "environment": "production"
}
```

### Scenario 2: Development with Missing Secret

```bash
$ NODE_ENV=development npm run dev
# [WARN] startup_validation_warning
# Server listening on port 3001
```

**Structured Log:**
```json
{
  "level": "warn",
  "event": "startup_validation_warning",
  "reason": "missing_github_webhook_secret",
  "environment": "development",
  "message": "GitHub webhooks will not be verified. This is only acceptable in development."
}
```

### Scenario 3: Production with Secret Configured

```bash
$ NODE_ENV=production GITHUB_WEBHOOK_SECRET=abc123... npm start
# [INFO] server_listen
# Server listening on port 3001
```

## Integration with Webhook Verification

The validation works with the existing webhook signature verification:

```
Request to /api/webhooks/github
    ↓
[Startup Validation] ← Ensures secret is configured
    ↓
[Signature Verification Middleware] ← Verifies HMAC-SHA256
    ↓
[Webhook Handler] ← Processes valid webhooks
```

**Verification Flow:**
1. Middleware extracts `x-hub-signature-256` header
2. Computes HMAC-SHA256 of payload using secret
3. Compares with timing-safe equality
4. Returns 401 if invalid, 202 if valid

## Deployment Guide

### Local Development

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Set a test secret (or leave empty to see warning)
echo "GITHUB_WEBHOOK_SECRET=test-secret-123" >> .env

# 3. Start development server
npm run dev
```

### Production Deployment

```bash
# 1. Generate secure random secret
SECRET=$(openssl rand -hex 20)
echo "Generated secret: $SECRET"

# 2. Set environment variable
export GITHUB_WEBHOOK_SECRET=$SECRET

# 3. Set production environment
export NODE_ENV=production

# 4. Start application
npm start
```

## Security Best Practices

1. **Generate Secure Secrets**
   ```bash
   openssl rand -hex 20  # 40-character hex string
   ```

2. **Store Securely**
   - Use environment variables
   - Use secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
   - Never commit to version control

3. **Rotate Periodically**
   - Update in GitHub webhook settings
   - Update in application environment
   - No downtime required

4. **Monitor Webhook Failures**
   - Check application logs for signature verification failures
   - Review GitHub webhook delivery logs
   - Alert on repeated failures

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "GITHUB_WEBHOOK_SECRET not configured" | Missing in production | Set environment variable |
| "GitHub webhooks will not be verified" | Missing in development | Expected; set if testing webhooks |
| Webhook returns 401 | Invalid signature | Verify secret matches GitHub settings |
| Webhook returns 500 | Secret not configured at runtime | Check environment variable |

## Testing

```bash
# Run all tests
npm test

# Run only webhook secret validation tests
npm test -- webhookSecretValidation.test.ts

# Run with coverage
npm run test:coverage
```

## Acceptance Criteria

- ✅ Production startup fails with clear error if secret missing
- ✅ Development startup logs warning if secret missing
- ✅ `.env.example` documents the variable
- ✅ Unit tests cover all scenarios (13 tests)
- ✅ Error messages are clear and actionable
- ✅ Validation runs before routes/servers initialized
- ✅ Integrates with existing webhook verification

## Files Changed

| File | Type | Changes |
|------|------|---------|
| `backend/src/validation/webhookSecretValidation.ts` | NEW | Validation logic |
| `backend/src/index.ts` | MODIFIED | Added validation call |
| `backend/test/webhookSecretValidation.test.ts` | NEW | 13 comprehensive tests |
| `.env.example` | MODIFIED | Enhanced documentation |
| `WEBHOOK_SECRET_VALIDATION.md` | NEW | Full documentation |

## Next Steps

1. Deploy to production with `GITHUB_WEBHOOK_SECRET` configured
2. Monitor webhook delivery logs
3. Set up alerts for webhook failures
4. Document secret rotation procedure for team
5. Consider adding webhook signature verification to other providers (if applicable)

## References

- [GitHub Webhook Security](https://docs.github.com/en/developers/webhooks-and-events/webhooks/securing-your-webhooks)
- [Node.js Crypto Module](https://nodejs.org/api/crypto.html)
- [12 Factor App - Config](https://12factor.net/config)
- [OWASP - Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
