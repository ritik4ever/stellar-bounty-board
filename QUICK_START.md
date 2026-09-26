# GitHub Webhook Secret Validation - Quick Start

## Table of Contents

- [What Was Implemented](#what-was-implemented)
- [Key Files](#key-files)
- [How It Works](#how-it-works)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Error Messages](#error-messages)
- [Security Checklist](#security-checklist)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Test Results](#test-results)
- [Acceptance Criteria](#acceptance-criteria)
- [Next Steps](#next-steps)
- [Support](#support)

**See also:** [CONTRIBUTING.md](CONTRIBUTING.md) (setup and PR checklist) ·
[docs/MAINTAINERS.md](docs/MAINTAINERS.md) (maintainer procedures) ·
[docs/wave-4.md](docs/wave-4.md) (wave backlog and "How to Contribute")

## What Was Implemented

A startup validation system that ensures `GITHUB_WEBHOOK_SECRET` is configured before the application starts, preventing unauthorized webhook events.

## Key Files

| File | Type | Purpose |
|------|------|---------|
| `backend/src/validation/webhookSecretValidation.ts` | NEW | Validation logic |
| `backend/src/app.ts`                                | MODIFIED | Configures webhook signature middleware using the secret |
| `backend/test/webhookSecretValidation.test.ts` | NEW | 25 comprehensive tests |
| `.env.example` | MODIFIED | Enhanced documentation |

## How It Works

> **Note:** `validateGitHubWebhookSecret()` in `backend/src/validation/webhookSecretValidation.ts`
> is exported and fully unit-tested, but it is **not currently invoked at startup** — neither `backend/src/index.ts`
> nor `backend/src/app.ts` calls it. The behavior described below is what the function does when called; the
> webhook signature middleware in `backend/src/app.ts` (`createGitHubWebhookSignatureMiddleware`)
> is what actually uses `GITHUB_WEBHOOK_SECRET` at runtime.


### Production (NODE_ENV=production)

```bash
$ NODE_ENV=production npm --prefix backend start
# If GITHUB_WEBHOOK_SECRET is missing:
# Error: GITHUB_WEBHOOK_SECRET environment variable is not configured...
# Exit code: 1
```

### Development (NODE_ENV=development or unset)

```bash
$ npm run dev:backend
# If GITHUB_WEBHOOK_SECRET is missing:
# [WARN] startup_validation_warning
# [INFO] server_listen { port: 3001 }
```

## Getting Started

### Production Deployment

```bash
# 1. Generate secret
SECRET=$(openssl rand -hex 20)

# 2. Set environment
export NODE_ENV=production
export GITHUB_WEBHOOK_SECRET=$SECRET

# 3. Start app
npm --prefix backend start
```

### Local Development

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Optional: Set test secret
echo "GITHUB_WEBHOOK_SECRET=test-secret-123" >> .env

# 3. Start dev server
npm run dev:backend
```

## Testing

```bash
# Run webhook secret validation tests
npm test -- webhookSecretValidation.test.ts

# Expected: 25 tests, all passing ✓
```

## Error Messages

### Production Error

```
Error: GITHUB_WEBHOOK_SECRET environment variable is not configured.
This is required to verify GitHub webhook signatures and prevent
unauthorized webhook events. Set GITHUB_WEBHOOK_SECRET to a secure
random string (e.g., openssl rand -hex 20).
```

### Development Warning

```
[WARN] startup_validation_warning
  reason: "missing_github_webhook_secret"
  environment: "development"
  message: "GitHub webhooks will not be verified. This is only acceptable in development."
```

## Security Checklist

- [ ] Generate secure secret: `openssl rand -hex 20`
- [ ] Set `GITHUB_WEBHOOK_SECRET` in production
- [ ] Set `NODE_ENV=production` in production
- [ ] Verify `.env` is in `.gitignore`
- [ ] Test startup with secret configured
- [ ] Test webhook signature verification
- [ ] Configure GitHub webhook with same secret

## Troubleshooting

| Problem                                | Solution                                                     |
| -------------------------------------- | ------------------------------------------------------------ |
| "GITHUB_WEBHOOK_SECRET not configured" | Set environment variable: `export GITHUB_WEBHOOK_SECRET=...` |
| Webhook returns 401                    | Verify secret matches GitHub webhook settings                |
| Webhook returns 500                    | Check that secret is set at runtime                          |

## Documentation

- **WEBHOOK_SECRET_VALIDATION.md** - Complete technical documentation
- **IMPLEMENTATION_SUMMARY.md** - Overview and deployment guide
- **WEBHOOK_SECURITY_GUIDE.md** - Visual guide with examples
- **CODE_EXAMPLES.md** - Complete code reference

## Contributing

This document covers the webhook secret validation feature only. The contribution process is deliberately not repeated here — it has one home, so there is only one version of it:

- [CONTRIBUTING.md](CONTRIBUTING.md) — local setup, Conventional Commits format, and the pull request checklist
- [docs/wave-4.md](docs/wave-4.md) — a wave backlog document, including its "How to Contribute" steps

If you landed here looking for how to pick up work, start with the wave document and follow the checklist in CONTRIBUTING.md.

## Test Results

✅ 25 tests in `backend/test/webhookSecretValidation.test.ts`:
- Run with: `npm test -- webhookSecretValidation.test.ts`

## Acceptance Criteria

✅ Production startup fails with clear error if secret missing
✅ Development startup logs warning if secret missing
✅ .env.example documents the variable
✅ Unit tests cover all scenarios
✅ Error messages are clear and actionable
✅ Validation runs before routes/servers initialized
✅ Integrates with existing webhook verification

## Next Steps

1. Review documentation
2. Deploy to staging
3. Test webhook verification
4. Deploy to production with secret configured
5. Monitor webhook delivery logs
6. Set up alerts for failures

## Support

For detailed information, see:

- Technical details: `WEBHOOK_SECRET_VALIDATION.md`
- Quick overview: `IMPLEMENTATION_SUMMARY.md`
- Visual guide: `WEBHOOK_SECURITY_GUIDE.md`
- Code reference: `CODE_EXAMPLES.md`
