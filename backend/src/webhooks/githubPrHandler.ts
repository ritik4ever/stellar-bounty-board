import { listBounties, releaseBounty } from "../services/bountyStore";
import { logStructured } from "../logger";
import { hasBeenProcessed, markAsProcessed } from "./deliveryDedup";

/**
 * Shape of a GitHub pull_request webhook payload (the fields we care about).
 *
 * @internal
 */
interface GitHubPrPayload {
  action: string;
  pull_request?: {
    html_url?: string;
    merged?: boolean;
  };
}

function isPrPayload(body: unknown): body is GitHubPrPayload {
  return (
    typeof body === "object" &&
    body !== null &&
    "action" in body &&
    typeof (body as Record<string, unknown>).action === "string"
  );
}

/**
 * Processes a GitHub `pull_request` webhook event.
 *
 * **Purpose:**
 * Automatically releases bounties when their associated PRs are merged,
 * eliminating a manual step for maintainers. This is triggered by the
 * `pull_request` event from GitHub's webhook delivery.
 *
 * **Acceptance criteria:**
 *  1. **Merged PR** → Finds the bounty whose `submissionUrl` matches the PR URL
 *     and automatically releases it (calls {@link releaseBounty}).
 *  2. **Closed but not merged** → Returns early without modifying any bounty.
 *  3. **No matching bounty** → Logs a notice and returns early (no error).
 *  4. **Duplicate delivery** → Checks deduplication store and returns early
 *     without re-running side-effects.
 *  5. **Manual release** → Concurrent manual releases via the API endpoint
 *     are unaffected (use optimistic versioning to detect race conditions).
 *
 * **Side-effects:**
 * - Calls {@link releaseBounty} if a merged PR matches a submitted bounty.
 * - Logs events at `info` level for tracking and debugging.
 * - Records the delivery ID in the deduplication store (marks as processed).
 *
 * **Concurrency:**
 * - Synchronous and async-friendly (returns a promise).
 * - Multiple concurrent webhook deliveries for different PRs are safe.
 * - Duplicate deliveries are detected and skipped via {@link hasBeenProcessed}.
 * - Concurrent manual releases (API) and automatic releases (webhook) may race;
 *   {@link releaseBounty} uses optimistic versioning to handle that.
 *
 * @param body - The raw webhook payload (should be a GitHub PR event).
 * @param deliveryId - The GitHub delivery ID from the `X-GitHub-Delivery` header (optional).
 *   Used for deduplication. If omitted, no deduplication is performed.
 * @returns A promise resolving to `{ duplicate: true }` if the delivery ID was already
 *   processed (dedup), or `{ duplicate: false }` otherwise.
 *
 * @throws {Error} Never throws. All errors (missing fields, API calls, state mutations)
 *   are caught, logged at `warn`/`error` level, and converted to a graceful response.
 *   The webhook HTTP handler wraps this function in `try`/`catch` as a safety net.
 *
 * **Logging:**
 * - `github_webhook_duplicate_delivery` (info): Delivery ID already processed.
 * - `github_webhook_pr_skipped` (info): PR event skipped (not closed or not merged).
 * - `github_webhook_pr_missing_url` (warn): PR event missing `html_url`.
 * - `github_webhook_pr_no_matching_bounty` (info): PR URL doesn't match any bounty.
 * - `github_webhook_pr_auto_releasing` (info): About to auto-release a bounty.
 * - `github_webhook_pr_auto_released` (info): Bounty auto-released successfully.
 *
 * @example
 * ```ts
 * // In an Express route handler:
 * app.post('/api/webhooks/github', signatureMiddleware, async (req, res) => {
 *   const deliveryId = req.header('x-github-delivery');
 *   try {
 *     const result = await handleGitHubPrEvent(req.body, deliveryId);
 *     if (result.duplicate) {
 *       res.status(200).json({ received: true, duplicate: true });
 *     } else {
 *       res.status(202).json({ received: true, duplicate: false });
 *     }
 *   } catch (error) {
 *     res.status(500).json({ error: error.message });
 *   }
 * });
 * ```
 */
export async function handleGitHubPrEvent(body: unknown, deliveryId?: string): Promise<{ duplicate: boolean }> {
  // Deduplication: if we have already processed this delivery ID, return early
  // without re-running any side-effects to prevent double-releases.
  if (deliveryId) {
    if (hasBeenProcessed(deliveryId)) {
      logStructured("info", "github_webhook_duplicate_delivery", {
        deliveryId,
        reason: "delivery ID already processed within TTL window",
      });
      return { duplicate: true };
    }
  }

  if (!isPrPayload(body)) {
    // Not a PR event we can handle — skip silently
    if (deliveryId) markAsProcessed(deliveryId);
    return { duplicate: false };
  }

  const { action, pull_request } = body;

  // Only process closed + merged events
  if (action !== "closed" || !pull_request?.merged) {
    logStructured("info", "github_webhook_pr_skipped", {
      action,
      merged: pull_request?.merged ?? false,
      reason: action !== "closed" ? "not_closed" : "not_merged",
    });
    if (deliveryId) markAsProcessed(deliveryId);
    return { duplicate: false };
  }

  const prUrl = pull_request.html_url;
  if (!prUrl) {
    logStructured("warn", "github_webhook_pr_missing_url", {
      reason: "pull_request.html_url is empty",
    });
    if (deliveryId) markAsProcessed(deliveryId);
    return { duplicate: false };
  }

  // Find a submitted bounty whose submissionUrl exactly matches the merged PR URL
  const bounties = listBounties();
  const matching = bounties.find(
    (b) => b.status === "submitted" && b.submissionUrl === prUrl,
  );

  if (!matching) {
    logStructured("info", "github_webhook_pr_no_matching_bounty", {
      prUrl,
      reason: "no submitted bounty with matching submissionUrl",
    });
    if (deliveryId) markAsProcessed(deliveryId);
    return { duplicate: false };
  }

  logStructured("info", "github_webhook_pr_auto_releasing", {
    bountyId: matching.id,
    prUrl,
    maintainer: matching.maintainer,
  });

  await releaseBounty(matching.id, matching.maintainer);

  logStructured("info", "github_webhook_pr_auto_released", {
    bountyId: matching.id,
    prUrl,
  });

  if (deliveryId) markAsProcessed(deliveryId);
  return { duplicate: false };
}
