# Webhook Security Documentation — Consolidated Reference

## Overview

The project has three separate documents covering webhook security:

1. `WEBHOOK_SECURITY_GUIDE.md` — Implementation guide for HMAC-SHA256 verification
2. `WEBHOOK_SECRET_VALIDATION.md` — Startup validation for GITHUB_WEBHOOK_SECRET
3. `SECURITY.md` — Overall security policy (CSP, logging, arbiter trust)

## When to read which

| Document                       | Read when...                                                        |
| ------------------------------ | ------------------------------------------------------------------- |
| `WEBHOOK_SECURITY_GUIDE.md`    | You are implementing or debugging webhook signature verification    |
| `WEBHOOK_SECRET_VALIDATION.md` | You are deploying and need to verify the webhook secret is set      |
| `SECURITY.md`                  | You need the overall security policy (CSP, logging, arbiter, scope) |

## Consolidation status

All three documents are verified as current (2026-10-01):

- `WEBHOOK_SECURITY_GUIDE.md` ✅ matches `backend/src/webhooks/signatureVerification.ts`
- `WEBHOOK_SECRET_VALIDATION.md` ✅ matches `backend/src/validation/webhookSecretValidation.ts` (now wired up in `index.ts` per PR #1582)
- `SECURITY.md` ✅ CSP drift corrected (per PR #1580)

No consolidation needed — each document serves a distinct audience.

<!-- Created: 2026-10-01 — per issue #1164 -->
