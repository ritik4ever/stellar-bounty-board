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

### Startup resume

`resumePendingDeliveries()` runs on server start (outside tests) and replays
journal entries that still have a PR URL. Each replay goes through the normal
handler with the original delivery ID, so duplicate suppression and idempotent
transitions behave exactly as for a live request. Replay failures leave the
record pending for the next attempt; nothing is thrown.

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
  manual-release race, invalid HMAC retry, deferred retry accounting.
- `backend/test/githubPrWebhook.test.ts` — end-to-end PR auto-release and
  duplicate-delivery behaviour.
- `backend/test/webhooks.comprehensive.test.ts` — handler and journal units.
