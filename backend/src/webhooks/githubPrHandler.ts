import { listBounties, releaseBounty } from "../services/bountyStore";
import { logStructured } from "../logger";
import { hasBeenProcessed, markAsProcessed } from "./deliveryDedup";
import { fetchPrFromGitHub, extractGithubPrNumber } from "../validation/prUrl";

/**
 * Shape of a GitHub pull_request webhook payload (the fields we care about).
 */
interface GitHubPrPayload {
  action: string;
  pull_request?: {
    html_url?: string;
    merged?: boolean;
    number?: number;
    body?: string;
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
 *  5. Duplicate delivery ID (same X-GitHub-Delivery) → returns early without
 *     re-running any side-effects (deduplication).
 *  6. PR issue verification (#765) → cross-checks that the merged PR references
 *     the bounty's target issue number via GitHub API. Hard-rejects or soft-warns
 *     per configuration mode. API failures degrade gracefully.
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

  // Verify that the PR references the funded issue number via GitHub API (#765)
  if (matching.issueNumber) {
    const repoParts = matching.repo.split("/");
    const owner = repoParts[0];
    const repo = repoParts[1];
    const prNumber = pull_request.number ?? extractGithubPrNumber(prUrl);

    if (owner && repo && prNumber !== undefined) {
      try {
        const verification = await fetchPrFromGitHub(owner, repo, prNumber);
        const referencesIssue = verification.closingIssueNumbers.includes(matching.issueNumber);

        if (!referencesIssue) {
          const softWarnMode =
            process.env.PR_ISSUE_VERIFY_MODE === "soft-warn" ||
            process.env.PR_ISSUE_VERIFY_SOFT_WARN === "true" ||
            process.env.GITHUB_PR_VERIFY_SOFT_WARN === "true" ||
            process.env.SOFT_WARN_PR_ISSUE_REF === "true";

          if (softWarnMode) {
            logStructured("warn", "github_webhook_pr_unmatched_issue_warning", {
              bountyId: matching.id,
              prUrl,
              expectedIssueNumber: matching.issueNumber,
              foundIssueNumbers: verification.closingIssueNumbers,
              mode: "soft-warn",
            });
          } else {
            logStructured("warn", "github_webhook_pr_unmatched_issue_rejected", {
              bountyId: matching.id,
              prUrl,
              expectedIssueNumber: matching.issueNumber,
              foundIssueNumbers: verification.closingIssueNumbers,
              mode: "hard-reject",
            });
            if (deliveryId) markAsProcessed(deliveryId);
            return { duplicate: false };
          }
        }
      } catch (err) {
        logStructured("warn", "github_webhook_pr_issue_verification_failed", {
          bountyId: matching.id,
          prUrl,
          expectedIssueNumber: matching.issueNumber,
          error: String(err),
          reason: "GitHub API call failed, degrading gracefully",
        });
        // Degrade gracefully: proceed with auto-release if GitHub API call fails
      }
    }
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
