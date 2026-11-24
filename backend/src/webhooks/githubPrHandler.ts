import { listBounties, releaseBounty, markBountyPrMerged } from '../services/bountyStore';
import { logStructured } from '../logger';
import { traceWebhookOutcome } from '../services/stateUpdateTrace';
import {
  beginDelivery,
  deferDelivery,
  getPendingDeliveries,
  markAsProcessed,
} from './deliveryDedup';

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

/**
 * Result of {@link handleGitHubPrEvent}.
 */
export interface GitHubPrHandlerResult {
  /** True when this delivery ID had already completed within the TTL window. */
  duplicate: boolean;
  /**
   * True when the event was accepted but could not be applied yet (for example
   * a merged-PR event that arrived before its bounty submission was recorded).
   * The delivery stays resumable and is retried on redelivery or at startup.
   */
  deferred?: boolean;
  /** Machine-readable reason for a deferred or skipped delivery. */
  reason?: string;
}

/** Summary returned by {@link resumePendingDeliveries}. */
export interface ResumeSummary {
  /** Number of unfinished deliveries that were re-driven. */
  resumed: number;
  /** Deliveries that completed during this resume pass. */
  completed: number;
  /** Deliveries that failed during this resume pass (they stay pending). */
  failed: number;
  /** Deliveries still pending after this pass. */
  remaining: number;
}

function isPrPayload(body: unknown): body is GitHubPrPayload {
  return (
    typeof body === 'object' &&
    body !== null &&
    'action' in body &&
    typeof (body as Record<string, unknown>).action === 'string'
  );
}

/**
 * Extracts the merged PR URL from a GitHub PR payload, if the event is one we
 * can act on.
 *
 * @internal
 */
function mergedPrUrl(body: unknown): string | undefined {
  if (!isPrPayload(body)) return undefined;
  if (body.action !== 'closed' || !body.pull_request?.merged) return undefined;
  const prUrl = body.pull_request.html_url;
  return prUrl ? prUrl : undefined;
}

async function releaseForMergedPr(
  bountyId: string,
  maintainer: string,
  prUrl: string,
  deliveryId?: string
): Promise<void> {
  try {
    await releaseBounty(bountyId, maintainer, undefined, 0, { deliveryRef: deliveryId });
  } catch (error) {
    // Another worker or a maintainer may have released the bounty between our
    // read and our write. That is a successful outcome for this delivery, not a
    // failure — re-reading under the store's existing lock is the only reliable
    // way to distinguish the two.
    const latest = listBounties().find((b) => b.id === bountyId);
    if (latest?.status === 'released') {
      logStructured('info', 'github_webhook_pr_already_released', {
        bountyId,
        prUrl,
        reason: 'bounty was released concurrently; treating delivery as succeeded',
      });
      return;
    }

    throw error;
  }
}

/**
 * Applies the side effects of an actionable merged-PR event.
 *
 * Extracted so both live deliveries and startup/resume replays share exactly
 * one implementation. Every step is idempotent: a resumed delivery that already
 * recorded the PR merge, or already released the bounty, completes without
 * duplicating events or audit records.
 *
 * @internal
 */
async function applyMergedPr(prUrl: string, deliveryId?: string): Promise<GitHubPrHandlerResult> {
  const bounties = listBounties();
  const candidates = bounties.filter((b) => b.submissionUrl === prUrl);
  const matching = candidates.find((b) => b.status === 'submitted');

  if (!matching) {
    const alreadyApplied = candidates.find((b) => b.status === 'released' || b.prMerged);
    if (alreadyApplied) {
      logStructured('info', 'github_webhook_pr_already_merged', {
        bountyId: alreadyApplied.id,
        prUrl,
        status: alreadyApplied.status,
        reason: 'delivery replayed after the merge was already applied',
      });
      if (deliveryId) markAsProcessed(deliveryId, { prUrl });
      return { duplicate: false, reason: 'already_applied' };
    }

    // Out-of-order delivery: GitHub can deliver `pull_request closed` before the
    // submission that points at it is committed, and a restart can wipe an
    // in-flight submission. Acknowledge the event but keep it deferred so it is
    // re-driven on redelivery or at startup — never mark it processed, which
    // would drop the release forever.
    traceWebhookOutcome({
      outcome: 'pending',
      bountyId: 'unmatched',
      transition: 'pr_merged',
      deliveryRef: deliveryId,
      eventRef: prUrl ? `pr:${prUrl}` : deliveryId,
      reason: 'out_of_order_close_event',
    });

    logStructured('info', 'github_webhook_pr_deferred_no_matching_bounty', {
      prUrl,
      deliveryId,
      reason: 'no submitted bounty with matching submissionUrl yet; delivery will be retried',
    });
    if (deliveryId) {
      deferDelivery(deliveryId, { prUrl, reason: 'no_matching_bounty' });
    }
    return { duplicate: false, deferred: true, reason: 'no_matching_bounty' };
  }

  // 1. Record PR merge state transition on the bounty (Issue #1449). Skipped when
  // a previous attempt already applied it, so retries never duplicate the event.
  if (!matching.prMerged) {
    await markBountyPrMerged(matching.id, prUrl, { deliveryRef: deliveryId });
  }

  const requireMaintainerConfirmation =
    process.env.WEBHOOK_REQUIRE_MAINTAINER_CONFIRMATION === 'true' ||
    process.env.WEBHOOK_AUTO_RELEASE === 'false';

  if (requireMaintainerConfirmation) {
    logStructured('info', 'github_webhook_pr_merged_pending_confirmation', {
      bountyId: matching.id,
      prUrl,
      maintainer: matching.maintainer,
      message:
        'PR merged confirmed via webhook; pending maintainer final confirmation to release funds',
    });
  } else {
    logStructured('info', 'github_webhook_pr_auto_releasing', {
      bountyId: matching.id,
      prUrl,
      maintainer: matching.maintainer,
    });

    await releaseForMergedPr(matching.id, matching.maintainer, prUrl, deliveryId);

    logStructured('info', 'github_webhook_pr_auto_released', {
      bountyId: matching.id,
      prUrl,
    });
  }

  if (deliveryId) markAsProcessed(deliveryId, { prUrl });
  return { duplicate: false };
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
 *  3. **No matching bounty** → The delivery is left **deferred**, not marked as
 *     processed, so a redelivery or the startup resume pass can still apply it
 *     once the submission is recorded (out-of-order close events).
 *  4. **Duplicate delivery** → A delivery that already *completed* within the
 *     TTL window is skipped via the persistent journal.
 *  5. **Interrupted delivery** → A delivery claimed by a worker that died before
 *     committing its effects is resumed (not skipped) on the next attempt.
 *  6. **Manual release** → Concurrent manual releases via the API endpoint are
 *     unaffected; an "already released" bounty counts as success.
 *
 * **Side-effects:**
 * - Claims / completes / defers the delivery in the persistent journal.
 * - Calls {@link releaseBounty} if a merged PR matches a submitted bounty.
 * - Logs events at `info`/`warn` level for tracking and debugging.
 *
 * **Concurrency:**
 * - Multiple concurrent webhook deliveries for different PRs are safe.
 * - Duplicate deliveries are detected via {@link beginDelivery}.
 * - Concurrent manual releases (API) and automatic releases (webhook) may race;
 *   {@link releaseBounty} guards the transition with the store lock, and the
 *   loser observes `status === 'released'` and treats the delivery as done.
 *
 * @param body - The raw webhook payload (should be a GitHub PR event).
 * @param deliveryId - The GitHub delivery ID from the `X-GitHub-Delivery` header (optional).
 *   Used for deduplication and resumption. If omitted, no journal entry is kept.
 * @returns A promise resolving to a {@link GitHubPrHandlerResult}.
 *
 * @throws {Error} Only when side effects fail after the delivery was deferred;
 *   the caller should respond 5xx so GitHub retries. Pass-through errors are
 *   never used to mark a delivery as processed.
 *
 * **Logging:**
 * - `github_webhook_duplicate_delivery` (info): Delivery ID already processed.
 * - `github_webhook_delivery_resumed` (info): Retrying a previously unfinished delivery.
 * - `github_webhook_pr_skipped` (info): PR event skipped (not closed or not merged).
 * - `github_webhook_pr_missing_url` (warn): PR event missing `html_url`.
 * - `github_webhook_pr_deferred_no_matching_bounty` (info): Out-of-order event kept for retry.
 * - `github_webhook_pr_auto_releasing` / `github_webhook_pr_auto_released` (info): Released.
 * - `github_webhook_pr_already_released` (info): Release applied by someone else first.
 * - `github_webhook_processing_failed` (error): Side effects failed; delivery deferred.
 */
export async function handleGitHubPrEvent(
  body: unknown,
  deliveryId?: string
): Promise<GitHubPrHandlerResult> {
  if (deliveryId) {
    const claim = beginDelivery(deliveryId, { prUrl: mergedPrUrl(body) });

    if (claim.decision === 'duplicate') {
      logStructured('info', 'github_webhook_duplicate_delivery', {
        deliveryId,
        reason: 'delivery ID already completed within TTL window',
      });
      return { duplicate: true };
    }

    if (claim.decision === 'resume') {
      logStructured('info', 'github_webhook_delivery_resumed', {
        deliveryId,
        attempt: claim.attempts,
        reason: 'previous attempt did not complete; resuming',
      });
    }
  }

  try {
    if (!isPrPayload(body)) {
      // Not a PR event we can handle — nothing to apply, so complete it.
      if (deliveryId) markAsProcessed(deliveryId);
      return { duplicate: false };
    }

    const { action, pull_request } = body;

    // Only process closed + merged events
    if (action !== 'closed' || !pull_request?.merged) {
      logStructured('info', 'github_webhook_pr_skipped', {
        action,
        merged: pull_request?.merged ?? false,
        reason: action !== 'closed' ? 'not_closed' : 'not_merged',
      });
      if (deliveryId) markAsProcessed(deliveryId);
      return { duplicate: false };
    }

    const prUrl = pull_request.html_url;
    if (!prUrl) {
      logStructured('warn', 'github_webhook_pr_missing_url', {
        deliveryId,
        reason: 'pull_request.html_url is empty; delivery left deferred for retry',
      });
      if (deliveryId) deferDelivery(deliveryId, { reason: 'missing_pr_url' });
      return { duplicate: false, deferred: true, reason: 'missing_pr_url' };
    }

    return await applyMergedPr(prUrl, deliveryId);
  } catch (error) {
    traceWebhookOutcome({
      outcome: 'failed',
      transition: 'pr_merged',
      deliveryRef: deliveryId,
      error: error instanceof Error ? error.message : String(error),
      reason: 'delivery_deferred_retry',
    });

    // Defer instead of dropping: GitHub redelivers failed webhooks, and the
    // startup resume pass picks up what a restart left behind.
    if (deliveryId) {
      deferDelivery(deliveryId, {
        prUrl: mergedPrUrl(body),
        reason: error instanceof Error ? error.message : 'processing_error',
      });
    }
    logStructured('error', 'github_webhook_processing_failed', {
      deliveryId,
      message: error instanceof Error ? error.message : String(error),
      reason: 'delivery deferred for retry',
    });
    throw error;
  }
}

/**
 * Re-drives unfinished webhook deliveries from the persistent journal.
 *
 * Run at startup so a merged-PR event that was interrupted by a deploy, or that
 * arrived before its bounty submission existed, is applied without waiting for
 * an operator to replay it from the GitHub UI. Each replay goes through
 * {@link handleGitHubPrEvent} with the original delivery ID, so duplicate
 * suppression and idempotent transitions apply exactly as for a live delivery.
 *
 * Deliveries without a stored PR URL cannot be reconstructed and are skipped
 * (they stay pending until pruned); this can only happen for events that were
 * not actionable in the first place.
 *
 * @returns Counts of resumed, completed, failed, and still-pending deliveries.
 *   Never throws: a failed replay leaves the delivery pending for the next pass.
 */
export async function resumePendingDeliveries(): Promise<ResumeSummary> {
  const pending = getPendingDeliveries();
  let completed = 0;
  let failed = 0;

  for (const delivery of pending) {
    if (!delivery.prUrl) continue;

    logStructured('info', 'github_webhook_delivery_resume_attempt', {
      deliveryId: delivery.deliveryId,
      attempts: delivery.attempts,
      prUrl: delivery.prUrl,
      previousReason: delivery.reason,
    });

    try {
      const result = await handleGitHubPrEvent(
        {
          action: 'closed',
          pull_request: { html_url: delivery.prUrl, merged: true },
        },
        delivery.deliveryId
      );
      if (!result.deferred) completed++;
    } catch (error) {
      failed++;
      logStructured('warn', 'github_webhook_delivery_resume_failed', {
        deliveryId: delivery.deliveryId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const remaining = getPendingDeliveries().length;
  logStructured('info', 'github_webhook_delivery_resume_complete', {
    resumed: pending.length,
    completed,
    failed,
    remaining,
  });

  return { resumed: pending.length, completed, failed, remaining };
}

/**
 * Direct sync helper to update PR merge state for a bounty (Issue #1449).
 *
 * @param bountyId - The ID of the bounty to sync.
 * @param prUrl - The URL of the merged pull request.
 * @param autoRelease - Whether to immediately disburse funds or await maintainer confirmation.
 */
export async function syncPrMergeState(
  bountyId: string,
  prUrl: string,
  autoRelease = false
): Promise<{ bountyId: string; prMerged: boolean; released: boolean }> {
  const bounty = await markBountyPrMerged(bountyId, prUrl);
  let released = false;

  if (autoRelease && bounty.status === 'submitted') {
    await releaseBounty(bounty.id, bounty.maintainer);
    released = true;
  }

  return {
    bountyId,
    prMerged: true,
    released,
  };
}
