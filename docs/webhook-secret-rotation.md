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

## Runbook: Bounded rotation window, verifiable signatures, and revoked-secret outcomes (#1968)

This runbook details how to operate within bounded rotation windows, verify signatures, detect observable failure signals, and resolve deliveries signed with revoked secrets.

### Bounded rotation window mechanics

- **Mathematical bounds:** The grace period window begins at `rotationStartedAt` and ends strictly at `expiresAt = rotationStartedAt + gracePeriodMs`. The maximum allowed grace period is 5 minutes (`300,000 ms`), defaulting to 5 minutes if unspecified.
- **Strict immutability:** The rotation state file is written exclusively using the `wx` file flag. Repeated execution of `node scripts/webhook-secret-rotation.cjs start` returns `rotation_unchanged` and leaves the original timestamp and expiration unmodified. Rerunning never shifts or extends the deadline.
- **Fail-closed expiration:** At the exact millisecond `Date.now() >= expiresAt`, the previous secret is deemed permanently revoked. The verifier transitions immediately from `grace` to `expired` phase.

### Verifiable signature evaluation order

1. **Active Secret (New):** Evaluated first using constant-time comparison (`crypto.timingSafeEqual`). If it matches, the delivery is authenticated immediately (`active_secret`), regardless of whether the rotation is in progress or has expired.
2. **Previous Secret (Old):** Evaluated only if the active secret does not match AND the current time is within the active grace period (`Date.now() < expiresAt`). If it matches during grace, it returns `grace_period_previous_secret`.
3. **Revoked Secret:** If the payload was signed with the previous secret but evaluated after `expiresAt`, the tool halts with `revoked_secret` (exit code 2).
4. **Invalid Signature:** If the signature matches neither secret, or if the payload was modified, verification fails with `invalid_signature` (exit code 1).

### Observable failure signals

| Component | Failure scenario | Observable signal | Exit code / Status |
|---|---|---|---|
| **Rotation tool (`check`)** | Delivery signed with revoked secret | `{"accepted": false, "reason": "revoked_secret"}` | **Exit code 2** |
| **Rotation tool (`check`)** | Malformed signature or tampered payload | `{"accepted": false, "reason": "invalid_signature"}` | **Exit code 1** |
| **Rotation tool (`start`)** | Conflicting secret pair or modified grace period | `Rotation stopped: Active secret does not match the recorded rotation` | **Exit code 1** |
| **Backend verifier** | Expired previous secret or untrusted signature | `WebhookSignatureError: Invalid GitHub webhook signature.` | **HTTP 401 Unauthorized** |
| **Backend middleware** | Missing raw body or misconfigured secret | `WebhookSignatureError: Missing GitHub webhook secret configuration.` | **HTTP 500 Internal Server Error** |

### Step-by-step incident runbook: Resolving a revoked-secret delivery

When an alert fires indicating a webhook was rejected with `revoked_secret` or HTTP 401 during/after a secret rotation:

1. **Quarantine and Preserve:**
   - Immediately reject the delivery. Do **not** process the webhook payload or trigger any downstream bounty/escrow actions.
   - Extract and save the raw webhook delivery payload, the `X-GitHub-Delivery` GUID, and the `X-Hub-Signature-256` header into your secure incident audit record. Do not alter or pretty-print the JSON bytes.
2. **Inspect with Verification Tool:**
   - Execute the check tool against the saved delivery:
     ```bash
     node scripts/webhook-secret-rotation.cjs check \
       --payload /path/to/raw-delivery.json \
       --signature 'sha256=<X-Hub-Signature-256-hex>'
     ```
   - Confirm the tool outputs `{"accepted": false, "reason": "revoked_secret"}` with exit code 2. This confirms the signature was authentic to the previous secret, but dispatched or received outside the valid rotation window.
3. **Check Delivery Deduplication Journal:**
   - Query backend webhook logs or database using the `X-GitHub-Delivery` GUID.
   - Determine whether an identical delivery was already received and processed earlier during the grace period. If already journaled, mark the incident as a benign late replay and take no further action.
4. **Audit GitHub Webhook Settings:**
   - Check the GitHub repository / organization Webhook settings.
   - Confirm that GitHub's webhook secret has been updated to the new secret (`WEBHOOK_ROTATION_NEW_SECRET`). If GitHub is still sending deliveries signed with the old secret, update GitHub's configuration immediately.
5. **Request Authentic Provider Redelivery:**
   - In GitHub Webhook settings → Recent Deliveries, locate the failed delivery and click **Redeliver**.
   - Because GitHub now signs with the active secret, the redelivered payload will verify cleanly under `active_secret` and process through standard idempotent channels.
   - **Critical:** Never manually sign an old payload or re-open the rotation window to clear an error.
6. **Decommission Previous Secret:**
   - After verifying all webhooks are successfully arriving with the active secret and no valid deliveries remain pending, remove the previous secret from secret managers and operator keyrings.

## Overlap transition: expected results at every boundary

This table documents the exact outcome at each significant point in time during a rotation. Use it to reproduce the transition from a clean checkout without live funds or network calls. `T` = `rotationStartedAt`, `G` = `gracePeriodMs`.

| Time (`Date.now()`) | Payload signed with | Expected result | HTTP status |
|---|---|---|---|
| `T` | new secret | Accepted (`active_secret`) | — |
| `T` | old secret | Accepted (`grace_period_previous_secret`) | — |
| `T + G - 1` | old secret | Accepted (`grace_period_previous_secret`) | — |
| `T + G - 1` | new secret | Accepted (`active_secret`) | — |
| `T + G` _(exact expiry)_ | old secret | Rejected (`revoked_secret`) | 401 |
| `T + G` _(exact expiry)_ | new secret | Accepted (`active_secret`) | — |
| `T + G + N` | old secret | Rejected (`revoked_secret`) | 401 |
| `T + G + N` | new secret | Accepted (`active_secret`) | — |
| any | neither secret | Rejected (`invalid_signature`) | 401 |
| any | — (misconfigured empty `newSecret`) | Rejected (server error) | 500 |

**Key invariants from the code:**

- `verifyWithSecretRotation` checks the new secret _first_, always. The old secret is only tried if the new secret does not match.
- The condition `Date.now() < rotationStartedAt + gracePeriodMs` is strictly `<`. At the exact expiry millisecond (`T + G`) the window is **closed**.
- A revoked-secret rejection carries `statusCode 401`, not 500. 500 is reserved for configuration errors (empty or missing `newSecret`, invalid `gracePeriodMs`, missing `rotationStartedAt`).
- `gracePeriodMs` is bounded `[1, 300_000]`. Values outside that range are rejected with 500 before any HMAC computation.

## Focused deterministic tests

Run from a clean checkout without live funds or network access:

```bash
node --test scripts/webhook-secret-rotation.test.cjs
# Optional, using the project's existing backend dependencies:
cd backend && node_modules/.bin/vitest run test/webhookSecretRotationReruns.test.ts test/webhookSecretValidation.test.ts
```

Both suites exercise deterministic overlap fixtures (old + new secrets during the bounded grace window) and revoked-secret deliveries (after expiry). The reruns suite additionally covers HTTP status codes at every boundary: `401` for revoked/invalid signatures, `500` for configuration errors, and the exact expiry millisecond (`T + G`) for both the minimum (`gracePeriodMs = 1`) and maximum (`gracePeriodMs = 300_000`) grace windows.

### Configuration Validation Guardrails (#1967)

- **Fail-fast validation before signing/verification:** `verifyWithSecretRotation` calls `validateWebhookRotationConfig` before normalizing headers or computing HMACs, rejecting empty/whitespace `newSecret` or `previousSecret`, identical `previousSecret === newSecret`, missing/invalid `rotationStartedAt`, and `gracePeriodMs` outside `1..300_000` ms with HTTP 500 `WebhookSignatureError`.
- **Environment overlap validation:** `validateWebhookSecretRotationEnv` (also invoked by `validateGitHubWebhookSecret` on startup) enforces that when rotation overlap variables (`GITHUB_WEBHOOK_SECRET_PREVIOUS`, `GITHUB_WEBHOOK_ROTATION_STARTED_AT`, `GITHUB_WEBHOOK_ROTATION_GRACE_MS`) are configured, the active and previous secrets are non-empty and distinct, the start timestamp is a non-negative integer, and the grace period does not exceed `300_000` ms.
- **CLI secret hygiene:** `scripts/webhook-secret-rotation.cjs` rejects empty or whitespace-only secrets before creating or reading rotation state.

Tests cover rerunning without shifting expiry, immutable parameters, current/previous HMAC signatures, boundary-time revocation, tampered payloads, invalid state and clock rollback. They use no external network or funds.

## Limitations

The state record is local; for multiple hosts or deployment replicas, store the canonical metadata in an operator-managed shared location (or consistently distribute a read-only copy). This tool is not a cross-process secret vault or distributed lock manager. It cannot guarantee delivery processing exactly once; rely on existing webhook delivery-ID journaling for that. Check the application's live signature verification configuration separately before using grace-period acceptance in production.
