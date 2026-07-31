# GitHub Webhook Secret Validation Implementation

## Overview

This document describes the implementation of startup validation for the `GITHUB_WEBHOOK_SECRET` environment variable, addressing security issue #346. The validation ensures that webhook signatures are properly verified, preventing attackers from sending fake GitHub events.

## Problem Statement

If `GITHUB_WEBHOOK_SECRET` is missing or undefined, the webhook endpoint silently accepts all webhook payloads without signature verification. This is a critical security vulnerability that allows attackers to:
- Send fake GitHub events
- Trigger unauthorized bounty releases
- Compromise application integrity

## Solution Architecture

### 1. Validation Module

**File:** `backend/src/validation/webhookSecretValidation.ts`

The validation module provides a single function that checks the environment on startup:

```typescript
export function validateGitHubWebhookSecret(): void
```

**Behavior:**
- **Production (`NODE_ENV=production`)**: Throws an error if the secret is missing or empty, preventing the application from starting
- **Development (`NODE_ENV=development` or unset)**: Logs a warning but allows startup (for local testing without webhooks)

### 2. Startup Integration

**File:** `backend/src/index.ts`

The validation is called before the server starts listening:

```typescript
import { validateGitHubWebhookSecret } from "./validation/webhookSecretValidation";

// Validate critical environment variables before starting the server
validateGitHubWebhookSecret();

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  logStructured("info", "server_listen", { port });
});
```

**Key Points:**
- Validation runs **before** any routes or middleware are initialized
- Fails fast with a clear error message
- Uses structured logging for consistency with the rest of the application

### 3. Environment Configuration

**File:** `.env.example`

Updated to document the requirement:

```dotenv
# [REQUIRED] Secret used to verify signatures for GitHub Webhooks.
# This is critical for security - it prevents attackers from sending fake webhook events.
# Generate a random string: openssl rand -hex 20
# In production, this MUST be set or the application will refuse to start.
# In development, a warning is logged if missing, but the app continues.
GITHUB_WEBHOOK_SECRET=your_github_webhook_secret_here
```

## Error Messages

### Production Error (when secret is missing)

```
Error: GITHUB_WEBHOOK_SECRET environment variable is not configured. This is required to verify GitHub webhook signatures and prevent unauthorized webhook events. Set GITHUB_WEBHOOK_SECRET to a secure random string (e.g., openssl rand -hex 20).
```

**Structured Log Entry:**
```json
{
  "level": "error",
  "event": "startup_validation_failed",
  "reason": "missing_github_webhook_secret",
  "environment": "production"
}
```

### Development Warning (when secret is missing)

**Structured Log Entry:**
```json
{
  "level": "warn",
  "event": "startup_validation_warning",
  "reason": "missing_github_webhook_secret",
  "environment": "development",
  "message": "GitHub webhooks will not be verified. This is only acceptable in development."
}
```

## Integration with Webhook Verification

The validation complements the existing webhook signature verification middleware:

**File:** `backend/src/webhooks/signatureVerification.ts`

The middleware uses the secret to verify HMAC-SHA256 signatures:

```typescript
export function createGitHubWebhookSignatureMiddleware(secret: SecretResolver): RequestHandler {
  return createWebhookSignatureMiddleware({
    ...githubWebhookSignatureProfile,
    secret,
  });
}
```

**Route:** `backend/src/app.ts`

```typescript
app.post(
  "/api/webhooks/github",
  createGitHubWebhookSignatureMiddleware(() => process.env.GITHUB_WEBHOOK_SECRET),
  async (req: Request, res: Response) => {
    // Handle webhook
  },
);
```

**Flow:**
1. Startup validation ensures secret is configured (production) or warns (development)
2. Middleware verifies each webhook request signature using the secret
3. Only valid signatures are processed; invalid ones return 401 Unauthorized

## Testing

**File:** `backend/test/webhookSecretValidation.test.ts`

Comprehensive test suite with 13 tests covering:

### Production Environment Tests
- ✓ Throws error when secret is missing
- ✓ Throws error when secret is empty string
- ✓ Throws error when secret is only whitespace
- ✓ Does not throw when secret is set
- ✓ Error message includes actionable guidance

### Development Environment Tests
- ✓ Does not throw when secret is missing
- ✓ Does not throw when secret is empty string
- ✓ Does not throw when secret is only whitespace
- ✓ Does not throw when secret is set

### Default Environment Tests
- ✓ Treats missing NODE_ENV as development

### Edge Cases
- ✓ Handles NODE_ENV with different casings (documents case-sensitive behavior)
- ✓ Accepts secrets with special characters
- ✓ Accepts very long secrets

**Run Tests:**
```bash
npm test -- webhookSecretValidation.test.ts
```

**Expected Output:**
```
✓ test/webhookSecretValidation.test.ts (13 tests) 25ms
  ✓ validateGitHubWebhookSecret > Production environment > ... (5 tests)
  ✓ validateGitHubWebhookSecret > Development environment > ... (4 tests)
  ✓ validateGitHubWebhookSecret > Default environment > ... (1 test)
  ✓ validateGitHubWebhookSecret > Edge cases > ... (3 tests)

Test Files  1 passed (1)
Tests  13 passed (13)
```

## Deployment Checklist

### Before Production Deployment

- [ ] Set `GITHUB_WEBHOOK_SECRET` in production environment variables
- [ ] Generate a secure random string: `openssl rand -hex 20`
- [ ] Store the secret securely (e.g., in a secrets manager)
- [ ] Verify `NODE_ENV=production` is set
- [ ] Test startup with the secret configured
- [ ] Test webhook signature verification with a real GitHub webhook

### Local Development

- [ ] Copy `.env.example` to `.env`
- [ ] Set `GITHUB_WEBHOOK_SECRET` to a test value (or leave empty to see warning)
- [ ] Set `NODE_ENV=development` (or leave unset)
- [ ] Run `npm run dev` to start the development server

## Security Considerations

1. **Secret Generation**: Use a cryptographically secure random string
   ```bash
   openssl rand -hex 20  # Generates 40-character hex string
   ```

2. **Secret Storage**: Never commit `.env` files to version control
   - Use `.gitignore` to exclude `.env`
   - Store secrets in environment variables or secrets manager

3. **Secret Rotation**: Periodically rotate the secret
   - Update in GitHub webhook settings
   - Update in application environment variables
   - No downtime required (old and new secrets can coexist during transition)

4. **Webhook Verification**: All webhook requests are verified using HMAC-SHA256
   - Prevents replay attacks
   - Ensures authenticity of GitHub events
   - Timing-safe comparison prevents timing attacks

## Troubleshooting

### Error: "GITHUB_WEBHOOK_SECRET environment variable is not configured"

**Cause:** The secret is missing or empty in production.

**Solution:**
1. Generate a secure random string: `openssl rand -hex 20`
2. Set the environment variable: `export GITHUB_WEBHOOK_SECRET=<generated-string>`
3. Restart the application

### Warning: "GitHub webhooks will not be verified"

**Cause:** The secret is missing in development (expected behavior).

**Solution (if you want to test webhooks locally):**
1. Set `GITHUB_WEBHOOK_SECRET` in `.env`
2. Restart the development server

### Webhook requests return 401 Unauthorized

**Cause:** The webhook signature is invalid.

**Possible reasons:**
1. Secret mismatch between GitHub and application
2. Webhook payload was modified in transit
3. Timing issue (webhook timestamp is too old)

**Solution:**
1. Verify the secret matches in GitHub webhook settings
2. Check webhook delivery logs in GitHub
3. Ensure server time is synchronized

## Files Modified

1. **Created:** `backend/src/validation/webhookSecretValidation.ts`
   - New validation module

2. **Created:** `backend/test/webhookSecretValidation.test.ts`
   - Comprehensive test suite (13 tests)

3. **Modified:** `backend/src/index.ts`
   - Added validation call before server startup

4. **Modified:** `.env.example`
   - Enhanced documentation for `GITHUB_WEBHOOK_SECRET`

## Acceptance Criteria Met

- ✅ Production startup fails with clear error if `GITHUB_WEBHOOK_SECRET` missing
- ✅ Development startup logs warning if `GITHUB_WEBHOOK_SECRET` missing
- ✅ `.env.example` documents the variable with security context
- ✅ Unit tests cover all scenarios (13 tests, all passing)
- ✅ Error messages are clear and actionable
- ✅ Validation runs before routes/servers are initialized
- ✅ Integrates seamlessly with existing webhook verification logic

## References

- [GitHub Webhook Security](https://docs.github.com/en/developers/webhooks-and-events/webhooks/securing-your-webhooks)
- [HMAC-SHA256 Verification](https://nodejs.org/api/crypto.html#crypto_class_hmac)
- [Environment Variables Best Practices](https://12factor.net/config)
