# Notification Delivery Worker Outcome Tracing

How the backend traces and records notification delivery outcomes across funding, reservation, submission, and payout flows without leaking credentials or private user data (#1948).

Related: [`README.md`](../README.md#notifications--state-change-hooks), [`backend/worker/README.md`](../backend/worker/README.md).

---

## Overview

Stellar Bounty Board dispatches lifecycle notifications via **SendGrid Email** or **Signed Webhooks** during major bounty state changes:
- `bounty_created` (funding / escrow deposit)
- `bounty_reserved` (contributor reservation)
- `bounty_submitted` (PR submission)
- `bounty_released` (payout to contributor)
- `bounty_refunded` (refund to maintainer)
- `bounty_disputed` (dispute raised or resolved)

Previously, notification dispatch was fire-and-forget with unstructured logging on failure. Operators could not tell from the logs whether a notification was in-flight, durably delivered, rate-limited by SendGrid, or lost to a webhook timeout.

This module introduces structured outcome tracing that makes delivery progression visible while upholding strict privacy and redaction guarantees.

---

## Delivery Outcomes & Operator Observability

Every delivery attempt emits structured single-line JSON records prefixed with:
```
[NotificationWorker][delivery-trace]
```

### Outcome States

```
                 dispatch begins                  HTTP 200/202
[Lifecycle Event] ─────────────► [pending] ────────────────────────► [committed]
                                    │
                                    │ Webhook timeout (504/Abort)
                                    │ or SendGrid 429
                                    ▼
                                 [failed]
                                 (with reason & redacted references)
```

1. **`pending`**: Emitted before the HTTP request is dispatched to SendGrid or the Webhook endpoint. If the server process is killed or crashes mid-flight, the last recorded state remains `pending`.
2. **`committed`**: Emitted only after the external provider acknowledges receipt (e.g. SendGrid 202 Accepted, Webhook 200 OK).
3. **`failed`**: Emitted when external delivery fails. The record captures the failure reason (`sendgrid_429`, `webhook_timeout`, `dispatch_error`), HTTP status code, and correlated redacted references.

Operators can distinguish a pending in-flight event from a committed transition by filtering for matching `deliveryRef` and `eventRef` across `pending` and `committed` records.

---

## Record Schema & Fields

Example trace record:

```json
{
  "event": "notification_delivery",
  "outcome": "pending",
  "at": "2026-11-24T16:50:00.000Z",
  "channel": "EMAIL",
  "lifecycleEvent": "bounty_reserved",
  "bountyId": "BNT-0042",
  "eventRef": "sha256:8b4f1c9902ad5e31",
  "deliveryRef": "sha256:a1e2f3c4d5b67890",
  "cursorRef": "sha256:4d87a9b0c1e2f3a4",
  "recipientCount": 1,
  "statusCode": null,
  "reason": null,
  "error": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | `string` | Fixed literal `"notification_delivery"`. |
| `outcome` | `string` | `"pending"`, `"committed"`, or `"failed"`. |
| `at` | `string` | ISO 8601 UTC timestamp. |
| `channel` | `string` | `"EMAIL"` or `"WEBHOOK"`. |
| `lifecycleEvent` | `string` | Lifecycle transition type (e.g., `"bounty_created"`). |
| `bountyId` | `string \| null` | Public bounty identifier (e.g., `"BNT-0042"`). |
| `eventRef` | `string \| null` | Truncated SHA-256 digest (`sha256:` + 16 hex chars) of the event ID. |
| `deliveryRef` | `string \| null` | Truncated SHA-256 digest of the delivery attempt identifier. |
| `cursorRef` | `string \| null` | Truncated SHA-256 digest of the Soroban/pagination cursor, if present. |
| `recipientCount` | `number \| undefined` | Total number of opted-in recipients. |
| `statusCode` | `number \| null` | HTTP response code (e.g., `200`, `202`, `429`, `504`). |
| `reason` | `string \| null` | Cause code: `"sendgrid_429"`, `"webhook_timeout"`, or `"dispatch_error"`. |
| `error` | `string \| null` | Sanitized error message with secrets and PII scrubbed. |

---

## Redaction Guarantees

All sensitive values are cryptographically redacted before log serialization:
- **`deliveryRef`, `eventRef`, `cursorRef`**: Hashed to deterministic `sha256:[0-9a-f]{16}`. Retains correlation capability while preventing reverse engineering of tokens, ledger positions, or IDs.
- **Stellar Secrets**: Any secret key matching `/S[0-9A-Z]{55}/` is scrubbed to `[redacted-secret-key]`.
- **API Keys & Tokens**: SendGrid keys (`SG....`), Bearer tokens, and Webhook secret signatures (`sha256=...`) are scrubbed.
- **Recipient PII**: Email addresses are scrubbed from log messages to prevent email leakage in log aggregators.

---

## Configuration

| Environment Variable | Default | Purpose |
|----------------------|---------|---------|
| `NOTIFICATION_CHANNEL` | Unset | Delivery channel (`EMAIL` or `WEBHOOK`). |
| `NOTIFICATION_WEBHOOK_URL` | Unset | Target URL for signed webhook deliveries. |
| `NOTIFICATION_WEBHOOK_SECRET` | Unset | HMAC-SHA256 secret for `X-Bounty-Signature`. |
| `NOTIFICATION_WEBHOOK_TIMEOUT_MS` | `10000` (10s) | Webhook HTTP request timeout in milliseconds before raising timeout. |
| `SENDGRID_API_KEY` | Unset | SendGrid API bearer token. |
| `NOTIFICATION_OPT_IN_STRICT` | `false` | When `true`, requires explicit opt-in preference record. |
