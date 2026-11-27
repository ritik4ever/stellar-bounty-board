# GitHub Webhook Delivery Reliability

How the backend makes `POST /api/webhooks/github` safe to retry after an invalid
signature, an out-of-order event, a crash, or a restart.

Related: [`webhook-signatures.md`](./webhook-signatures.md) (HMAC verification)
and [`webhook-security-consolidated.md`](./webhook-security-consolidated.md).

---

## The problem

GitHub delivers webhook events **at least once**. The same event can arrive
again with the same `X-GitHub-Delivery` ID when:

- the endpoint returned a 5xx or timed out,
- the process was restarted or redeployed mid-request,
- an operator clicks "Redeliver" in the GitHub UI.

Before this change, delivery de-duplication was an in-memory `Map` and every
non-actionable path called `markAsProcessed()`. That had two failure modes:

| Situation                                                                                      | Old behaviour                                    | Result                                                                                    |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Worker dies after releasing funds but before recording the delivery                            | Retry re-entered the release path                | `releaseBounty` threw because the bounty was already released; GitHub retried forever     |
| `pull_request closed` arrives before the bounty submission is recorded (out-of-order delivery) | "No matching bounty" was marked as **processed** | Later retries were skipped; the release was **lost**                                      |
| Process restarts                                                                               | In-memory set is empty                           | A redelivery re-ran side effects, duplicating `pr_merged` events                          |
| Invalid HMAC signature                                                                         | 401, nothing recorded                            | Correct — but the delivery ID must stay reusable, which only holds if nothing was written |

---

## The delivery journal

`backend/src/webhooks/deliveryDedup.ts` keeps a small JSON journal (default
`data/bounties.webhook-deliveries.json`, next to the bounty store) with one
record per `X-GitHub-Delivery` ID:

| Status        | Meaning                                                                                  | Retry behaviour                              |
| ------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| `in_progress` | A worker claimed the delivery and is applying side effects.                              | Resumed                                      |
| `pending`     | Processing could not complete (no matching bounty yet, transient error, missing PR URL). | Resumed                                      |
| `completed`   | Every side effect committed successfully.                                                | Skipped as a duplicate inside the TTL window |

Writes use a temp file plus atomic rename, so an interrupted write leaves the
previous or the new journal — never a torn file. A missing, empty, or corrupt
journal is logged at `warn` and treated as empty; it never takes the webhook
route down.

The journal stores only delivery metadata (status, attempt count, PR URL).
Bounty state remains the source of truth and every transition is guarded by the
existing store lock, which is what makes replaying a delivery idempotent.

### Lifecycle

```
      beginDelivery()                 side effects OK
 new ─────────────────► in_progress ─────────────────► completed
          ▲                  │
          │                  │  no matching bounty / error
          │                  ▼
          └─────────────── pending ──── redelivery or startup resume ──► …
```

- `beginDelivery()` is called **before** side effects. A crashed worker leaves
  `in_progress` behind, so the next attempt is classified `resume`, not
  `duplicate`.
- `deferDelivery()` records `pending` plus the PR URL. Nothing is acknowledged as
  done, so the effect can still be applied.
- `markAsProcessed()` is called only after every side effect committed.

### Handler guarantees

`handleGitHubPrEvent` in `backend/src/webhooks/githubPrHandler.ts`:

1. **Merged PR, matching submitted bounty** → marks `prMerged`, releases the
   bounty (unless `WEBHOOK_REQUIRE_MAINTAINER_CONFIRMATION=true`), completes the
   delivery.
2. **Merged PR, bounty not submitted yet** → responds `202` with
   `{ deferred: true, reason: "no_matching_bounty" }` and leaves the delivery
   pending. It is applied on redelivery or by the startup resume pass.
3. **Already applied** (bounty released or `prMerged` already true) → completes
   without writing duplicate `prMerged` / `released` events or audit entries.
4. **Concurrent manual release** → the losing writer observes
   `status === "released"` and treats the delivery as succeeded.
5. **Invalid HMAC signature** → rejected by the signature middleware with `401`
   before the handler runs, so the delivery ID is never consumed.

### Two delivery IDs for one merged PR

GitHub usually redelivers with the same `X-GitHub-Delivery` ID, but the same
merged PR can also arrive under two different IDs (for example after a webhook
reconfiguration or through a proxy that retries). The delivery journal cannot
suppress the second ID, so the guarantee lives at the bounty store boundary:
`markBountyPrMerged` re-checks `prMerged` **inside** the store lock and returns
the existing record without a version bump, `pr_merged` event, or audit entry.
`releaseBounty` has the same guard. Two concurrent deliveries therefore produce
exactly one `pr_merged` event and one `released` event, and both requests
acknowledge success.

### Startup resume

`resumePendingDeliveries()` runs on server start (outside tests) and replays
journal entries that still have a PR URL. Each replay goes through the normal
handler with the original delivery ID, so duplicate suppression and idempotent
transitions behave exactly as for a live request. Replay failures leave the
record pending for the next attempt; nothing is thrown.

### Outcome tracing for GitHub webhooks (#1943)

Every webhook lifecycle event emits structured trace records so operators can
monitor delivery outcomes and distinguish pending work from committed transitions:

1. **Invalid HMAC signatures (`outcome: 'failed'`):**
   When incoming signature verification fails (HTTP 401), a trace record is emitted
   recording a redacted delivery reference (`deliveryRef: sha256:...`), a redacted
   event/signature reference (`eventRef: sha256:...`), and error `'invalid_hmac_signature'`.
   Raw secret keys, tokens, and delivery GUIDs are never leaked in log lines.
2. **Out-of-order close events (`outcome: 'pending'`):**
   When a merged PR arrives before the corresponding bounty submission exists, the
   delivery is deferred and a trace is emitted with `outcome: 'pending'`,
   `bountyId: 'unmatched'`, `transition: 'pr_merged'`, `deliveryRef: sha256:...`,
   and `reason: 'out_of_order_close_event'`.
3. **Committed transitions (`outcome: 'committed'`):**
   When the bounty submission is recorded and the delivery is applied (on redelivery or
   startup resume), `markBountyPrMerged` and `releaseBounty` emit `committed` trace
   records with the matching `deliveryRef: sha256:...`.
4. **Distinguishing pending from committed work:**
   Operators can correlate events by matching `deliveryRef` and directly check
   whether a delivery is still in `pending` status or has advanced to `committed`.

### Security input validation (#1942)

Untrusted input arriving at `POST /api/webhooks/github` is strictly validated to prevent unauthorized bounty state manipulation, denial of service, or secret leakage:

- **Unauthenticated payloads:** Missing or invalid `X-Hub-Signature-256` signatures fail closed with `401 Unauthorized`. Delivery IDs are never recorded into the journal for unauthenticated requests, and secrets are never echoed in errors or responses.
- **Header validation:** The `X-GitHub-Delivery` header is constrained to valid identifiers (`/^[a-zA-Z0-9_-]{1,256}$/`). Headers containing control characters, path traversal (`../`), or excessive length are rejected with `400 Bad Request`.
- **Payload structure:** Incoming JSON must be a valid non-null object; malformed JSON or arrays return `400 Bad Request`.
- **PR URL schema enforcement:** In closed/merged PR deliveries, `pull_request.html_url` is validated against `githubPrUrlSchema`. Malformed URLs (such as `javascript:...`, non-GitHub hostnames, or invalid structures) are rejected with `400 Bad Request` and logged at `warn` level; they are never deferred into the journal as pending retries.
- **Two deliveries for the same merged PR:** When two deliveries arrive for the same merged PR, the bounty store guards ensure transitions (`pr_merged`, `released`) occur exactly once. Untrusted or tampered subsequent deliveries are rejected without altering bounty state.

---

## Configuration

| Variable                            | Default                                  | Purpose                                                |
| ----------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| `WEBHOOK_DELIVERY_STORE_PATH`       | `<bounty store>.webhook-deliveries.json` | Journal file path                                      |
| `WEBHOOK_DEDUP_TTL_MS`              | `600000` (10 min)                        | How long a completed delivery suppresses duplicates    |
| `WEBHOOK_DELIVERY_CLAIM_STALE_MS`   | `86400000` (24 h)                        | How long an unfinished delivery is kept for resumption |
| `WEBHOOK_DEDUP_CLEANUP_INTERVAL_MS` | `60000` (1 min)                          | Background prune cadence                               |

## Operational notes

- The journal must live on persistent storage (same volume as the bounty store)
  for restart safety. Set `WEBHOOK_DELIVERY_STORE_PATH` explicitly if the bounty
  store path is ephemeral.
- The journal is not a distributed lock. Two processes may race on the same
  delivery; the bounty store's lock means only one commits the release, and the
  other observes the committed state and treats it as success.
- Unfinished records older than `WEBHOOK_DELIVERY_CLAIM_STALE_MS` are pruned with
  a `webhook_delivery_journal_pruning_stale_delivery` warning so the file cannot
  grow without bound.
- Log events to watch: `github_webhook_delivery_resumed`,
  `github_webhook_pr_deferred_no_matching_bounty`,
  `github_webhook_processing_failed`, `github_webhook_delivery_resume_complete`.

## Tests

- `backend/test/webhookDeliveryResume.test.ts` — restart persistence, interrupted
  claim resumption, out-of-order merged event, startup resume, idempotent replay,
  two distinct delivery IDs for one merged PR, manual-release race, invalid HMAC
  retry, deferred retry accounting.
- `backend/test/githubPrWebhook.test.ts` — end-to-end PR auto-release and
  duplicate-delivery behaviour.
- `backend/test/webhooks.comprehensive.test.ts` — handler and journal units.

## Notification delivery worker input validation (#1947)

The delivery worker (`src/services/notificationService.ts`) sits behind two trust
boundaries: caller-supplied dispatch input, and the on-disk delivery journal that
`resumePendingNotificationDeliveries()` re-plays on startup.

### Schemas

Inputs are validated against `src/validation/notification.ts` **before** any
outbound HTTP call, journal write, or preference lookup:

| Field | Rule |
|---|---|
| `recipients[].address` | non-empty, ≤254 chars, no control characters |
| `recipients[].role` | non-empty, ≤64 chars, `^[a-zA-Z0-9_-]+$` |
| `event` | non-empty, ≤64 chars, `^[a-z][a-z0-9_.]*$` (not enum-restricted) |
| `payload` | JSON-serializable, serialized size ≤64 KiB |
| `deliveryRef` | non-empty, ≤128 chars, `^[a-zA-Z0-9._:-]+$` |
| `NOTIFICATION_WEBHOOK_URL` | must be a well-formed **https** URL |

### Rejection semantics

Invalid input produces per-recipient `{ status: 'failed', error: 'invalid_input' }`
outcomes and a single `notification_input_rejected` structured log entry. The
worker never throws: the resume loop relies on the no-throw contract.

### Journal trust boundary

`resumePendingNotificationDeliveries()` re-validates each pending entry against
`notificationJournalEntrySchema` before replay. Invalid entries are logged
(`notification_delivery_resume_rejected`), counted as `failed`, and left
unmodified in the journal so operators can inspect them.

### Outbound timeouts

Both `fetch` calls pass `AbortSignal.timeout(NOTIFICATION_TIMEOUT_MS)`
(default `10000`, max `60000`). A `429` from SendGrid is surfaced distinctly
with the `Retry-After` header preserved in the error string; retries are handled
by the existing resume loop, not in-place.
