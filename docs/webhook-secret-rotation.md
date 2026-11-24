# Webhook secret rotation: rerun-safe procedure

Issue: [#1966](https://github.com/ritik4ever/stellar-bounty-board/issues/1966) · SBB-2026-497

This document supplements [webhook-signatures.md](webhook-signatures.md). It covers **GitHub webhook inbound signatures**, not on-chain escrow credentials, account private keys, or outgoing notification signing.

## What is currently implemented

- `backend/src/webhooks/signatureVerification.ts` has `signWebhookPayload`, `verifyWithSecretRotation`, and a timing-safe HMAC-SHA256 signature verifier. `verifyWithSecretRotation` accepts the previous secret only until `rotationStartedAt + gracePeriodMs`.
- `POST /api/webhooks/github` currently uses `createGitHubWebhookSignatureMiddleware(() => process.env.GITHUB_WEBHOOK_SECRET)` with **one configured secret**. The route does not automatically read the rotation-state file or accept both keys. **This tool does not change that route.** Operators must coordinate provider and receiver secret changes, and should not assume a dual-key deployment exists.
- `scripts/webhook-secret-rotation.cjs` is a **read-only verification / rotation planning tool**. It creates one local metadata record, does not write secrets, does not call GitHub, and cannot change deployed configuration. Its tests use synthetic secrets and payloads.

## Invariants

1. The first `start` creates a rotation record containing only SHA-256 *fingerprints* of the two secrets and a fixed UTC start/deadline. It creates the file exclusively (`wx`), so reruns cannot overwrite it or move the deadline.
2. A rerun with the **same keys and grace period** reuses the original dates. Changing either secret or grace period stops with an error. Even after expiry, rerunning does not start another window.
3. The maximum grace window is five minutes (300,000 ms), matching the verifier's documented default. The old secret is considered revoked at the exact expiry instant. The new secret is always the one to keep.
4. Signature checks use the **unmodified raw request-body bytes** and timing-safe HMAC comparison. A revoked previous-secret signature returns `accepted:false` and exit code **2**; other invalid signatures exit **1**.
5. When rotation state is missing or corrupt, stop. **Never create a new state file just to make an old delivery verify again.** Use the original authenticated record or investigate manually.

## Setup (no packages required)

Use Node.js already available for the project. The default metadata location is `$HOME/.stellar-bounty-board/webhook-rotation.json`, **outside the Git checkout**. Keep it private, backed up, and consistent across operator reruns. Do not commit it. It stores SHA-256 secret fingerprints, which should still be treated as sensitive operational metadata; use randomly generated high-entropy secrets (32 bytes or more).

The following Git Bash example prompts without echoing secrets or putting them into command history:

```bash
read -rs -p 'Previous webhook secret: ' WEBHOOK_ROTATION_OLD_SECRET; echo
read -rs -p 'New webhook secret: ' WEBHOOK_ROTATION_NEW_SECRET; echo
export WEBHOOK_ROTATION_OLD_SECRET WEBHOOK_ROTATION_NEW_SECRET
node scripts/webhook-secret-rotation.cjs start
node scripts/webhook-secret-rotation.cjs status
```

For repeated deployment attempts, run `start` again using the same secret pair; it returns `rotation_unchanged` and the original `expiresAt` date. Do not delete the state file to reset the deadline. To use an operator-managed location, append `--state /secure/path/webhook-rotation.json` to every invocation. You can choose a shorter grace period for the **first** run using `--grace-ms 60000`; it cannot be changed afterward.

**Important:** Register and deploy the new GitHub secret through the existing provider and backend secret-management process. The tool neither provisions secrets nor changes the webhook route. The current route accepts only the configured `GITHUB_WEBHOOK_SECRET`; dual-key delivery verification would need its own explicit integration and deployment review.

## Check a delivery (never re-sign it yourself)

Capture the original raw payload bytes and `X-Hub-Signature-256` from trusted delivery logs/tools. Do not add whitespace or reserialize JSON. Use:

```bash
node scripts/webhook-secret-rotation.cjs check \
  --payload /secure/path/delivery-body.json \
  --signature 'sha256=<actual-64-hex-signature>'
```

Results:

| Result | Meaning | Action |
| --- | --- | --- |
| `active_secret`, exit 0 | Authenticated with current secret | Process **only through** the regular replay/deduplication path |
| `grace_period_previous_secret`, exit 0 | Previous secret verified within the recorded window | May be handled only during the original grace period, subject to duplicate-delivery checks |
| `revoked_secret`, exit 2 | HMAC matches the previous secret **after** expiry | **Stop**: do not process or manually re-sign the payload |
| `invalid_signature`, exit 1 | No matching valid signature | Stop and investigate; do not act on the payload |
| `Rotation stopped`, exit 1 | Missing/corrupt state, mismatched keys, or clock rollback | Stop and recover a trusted record/configuration |

### Recovery after a revoked-secret delivery

1. **Reject the delivery** and leave bounty/funding/escrow state untouched. This is not evidence of a valid user instruction after revocation.
2. Record the GitHub delivery ID, UTC time, status and reason in incident logs. **Never log raw secrets or sensitive payloads**. Check if a valid delivery of the same ID was already processed through the webhook delivery deduplication/journal system.
3. Confirm GitHub's configured webhook secret and the backend's current `GITHUB_WEBHOOK_SECRET` match. Verify the rotation record's original expiry and check for clock skew across hosts.
4. If needed, request an **authentic provider redelivery signed with the current configured secret** and process it through the normal signature verification and idempotent delivery path. Do not create a signature yourself for an untrusted old payload or temporarily reenable a revoked secret.
5. If a properly authenticated redelivery is unavailable, investigate and reconcile state using independently verified GitHub/bounty records and the project's established administrative process. Do not replay financial actions just to clear an alert.
6. Remove access to the old secret in secret management after the window has ended. Keep an audit trail of the rotation; do not delete the metadata simply to start the window again.

For a **compromised** previous secret, revoke access immediately at the service/provider boundary; do not grant it an additional grace period. Note that the planning tool cannot change the live backend configuration.

## Focused deterministic tests

```bash
node --test scripts/webhook-secret-rotation.test.cjs
# Optional, using the project's existing backend dependencies:
cd backend && npx vitest run test/webhookSecretRotationReruns.test.ts
```

Tests cover rerunning without shifting expiry, immutable parameters, current/previous HMAC signatures, boundary-time revocation, tampered payloads, invalid state and clock rollback. They use no external network or funds.

## Limitations

The state record is local; for multiple hosts or deployment replicas, store the canonical metadata in an operator-managed shared location (or consistently distribute a read-only copy). This tool is not a cross-process secret vault or distributed lock manager. It cannot guarantee delivery processing exactly once; rely on existing webhook delivery-ID journaling for that. Check the application's live signature verification configuration separately before using grace-period acceptance in production.
