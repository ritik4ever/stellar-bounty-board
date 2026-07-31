import { listBounties, releaseBounty } from "../services/bountyStore";
import { logStructured } from "../logger";

/**
 * Shape of a GitHub pull_request webhook payload (the fields we care about).
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
 * Acceptance criteria:
 *  1. Merged PR  → finds the bounty whose `submissionUrl` matches and auto-releases it.
 *  2. Closed-but-not-merged PR → returns early without touching any bounty.
 *  3. No matching bounty URL → ignored gracefully (log only).
 *  4. Manual release via the API endpoint is unaffected.
 */
export async function handleGitHubPrEvent(body: unknown): Promise<void> {
  if (!isPrPayload(body)) {
    // Not a PR event we can handle — skip silently
    return;
  }

  const { action, pull_request } = body;

  // Only process closed + merged events
  if (action !== "closed" || !pull_request?.merged) {
    logStructured("info", "github_webhook_pr_skipped", {
      action,
      merged: pull_request?.merged ?? false,
      reason: action !== "closed" ? "not_closed" : "not_merged",
    });
    return;
  }

  const prUrl = pull_request.html_url;
  if (!prUrl) {
    logStructured("warn", "github_webhook_pr_missing_url", {
      reason: "pull_request.html_url is empty",
    });
    return;
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
    return;
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
}
