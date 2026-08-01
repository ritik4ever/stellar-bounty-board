import { parsePrUrl } from "../validation/urlParser";
import { listBounties, releaseBounty } from "../services/bountyStore";
import { logStructured } from "../logger";
import { hasBeenProcessed, markAsProcessed } from "./deliveryDedup";

export type WebhookProvider = "github" | "gitlab" | "bitbucket";

/**
 * Shape of a GitLab merge_request webhook payload (the fields we care about).
 */
interface GitLabMrPayload {
  object_kind: "merge_request";
  object_attributes: {
    action: string;
    url?: string;
    state: string;
    merge_status?: string;
  };
}

/**
 * Shape of a Bitbucket pullrequest webhook payload (the fields we care about).
 */
interface BitbucketPrPayload {
  pullrequest?: {
    links?: {
      html?: {
        href?: string;
      };
    };
    state?: string;
    merged?: boolean;
  };
}

/**
 * Normalised merge / pull request event extracted from any supported provider.
 */
interface NormalisedPrEvent {
  provider: WebhookProvider;
  prUrl: string;
  isMerged: boolean;
}

/**
 * Attempt to extract a normalised PR event from a GitHub webhook payload.
 */
function extractGitHubPrEvent(body: Record<string, unknown>): NormalisedPrEvent | null {
  const action = body.action;
  const pullRequest = body.pull_request as Record<string, unknown> | undefined;

  if (typeof action !== "string" || !pullRequest) return null;

  const htmlUrl = pullRequest.html_url;
  if (typeof htmlUrl !== "string") return null;

  return {
    provider: "github",
    prUrl: htmlUrl,
    isMerged: action === "closed" && pullRequest.merged === true,
  };
}

/**
 * Attempt to extract a normalised PR event from a GitLab webhook payload.
 */
function extractGitLabMrEvent(body: Record<string, unknown>): NormalisedPrEvent | null {
  const objectKind = body.object_kind;
  if (objectKind !== "merge_request") return null;

  const attrs = body.object_attributes as Record<string, unknown> | undefined;
  if (!attrs) return null;

  const url = attrs.url;
  const state = attrs.state;
  if (typeof url !== "string" || typeof state !== "string") return null;

  return {
    provider: "gitlab",
    prUrl: url,
    isMerged: state === "merged",
  };
}

/**
 * Attempt to extract a normalised PR event from a Bitbucket webhook payload.
 */
function extractBitbucketPrEvent(body: Record<string, unknown>): NormalisedPrEvent | null {
  const pr = body.pullrequest as Record<string, unknown> | undefined;
  if (!pr) return null;

  const links = pr.links as Record<string, unknown> | undefined;
  const html = links?.html as Record<string, unknown> | undefined;
  const href = html?.href;
  const state = pr.state;
  const merged = pr.merged;

  if (typeof href !== "string") return null;

  return {
    provider: "bitbucket",
    prUrl: href,
    isMerged: state === "MERGED" || merged === true,
  };
}

/**
 * Detect the webhook provider from the payload structure and extract a
 * normalised PR/MR event. Returns `null` if the payload is unrecognised.
 */
function detectAndExtract(body: unknown): NormalisedPrEvent | null {
  if (typeof body !== "object" || body === null) return null;

  const record = body as Record<string, unknown>;

  const github = extractGitHubPrEvent(record);
  if (github) return github;

  const gitlab = extractGitLabMrEvent(record);
  if (gitlab) return gitlab;

  const bitbucket = extractBitbucketPrEvent(record);
  if (bitbucket) return bitbucket;

  return null;
}

/**
 * Processes a webhook event for a merged pull/merge request from any
 * supported provider (GitHub, GitLab, Bitbucket).
 *
 * Acceptance criteria:
 *  1. Merged PR/MR → finds the bounty whose `submissionUrl` matches and auto-releases it.
 *  2. Closed-but-not-merged / non-merge events → returns early without touching any bounty.
 *  3. No matching bounty URL → ignored gracefully (log only).
 *  4. Manual release via the API endpoint is unaffected.
 *  5. Duplicate delivery ID (same X-GitHub-Delivery) → returns early without
 *     re-running any side-effects (deduplication).
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

  if (!event.isMerged) {
    logStructured("info", "pr_webhook_skipped", {
      provider: event.provider,
      prUrl: event.prUrl,
      reason: "not_merged",
    });
    if (deliveryId) markAsProcessed(deliveryId);
    return { duplicate: false };
  }

  const { prUrl } = event;

  // Validate the URL is a recognised PR/MR URL format
  const parsed = parsePrUrl(prUrl);
  if (!parsed) {
    logStructured("warn", "pr_webhook_unrecognised_url", {
      provider: event.provider,
      prUrl,
      reason: "URL does not match known PR/MR format",
    });
    if (deliveryId) markAsProcessed(deliveryId);
    return { duplicate: false };
  }

  // Find a submitted bounty whose submissionUrl matches the merged PR/MR URL
  const bounties = listBounties();
  const matching = bounties.find(
    (b) => b.status === "submitted" && b.submissionUrl === prUrl,
  );

  if (!matching) {
    logStructured("info", "pr_webhook_no_matching_bounty", {
      provider: event.provider,
      prUrl,
      reason: "no submitted bounty with matching submissionUrl",
    });
    if (deliveryId) markAsProcessed(deliveryId);
    return { duplicate: false };
  }

  logStructured("info", "pr_webhook_auto_releasing", {
    bountyId: matching.id,
    prUrl,
    provider: event.provider,
    maintainer: matching.maintainer,
  });

  await releaseBounty(matching.id, matching.maintainer);

  logStructured("info", "pr_webhook_auto_released", {
    bountyId: matching.id,
    prUrl,
    provider: event.provider,
  });

  if (deliveryId) markAsProcessed(deliveryId);
  return { duplicate: false };
}

/** @deprecated Use `handlePrEvent` which supports GitHub, GitLab, and Bitbucket. */
export const handleGitHubPrEvent = handlePrEvent;
