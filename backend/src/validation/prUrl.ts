import { z } from "zod";
import { getCache } from "../services/cache";
import { logStructured } from "../logger";

const GITHUB_PR_URL_REGEX = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+$/;

/** TTL for caching GitHub PR verification results (5 minutes). */
const PR_CACHE_TTL_SECONDS = 5 * 60;

export const githubPrUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(
    (url) => {
      try {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname === "github.com";
      } catch {
        return false;
      }
    },
    { message: "Submission URL must be from github.com" },
  )
  .refine(
    (url) => {
      try {
        const parsedUrl = new URL(url);
        const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
        return pathParts.length >= 3 && pathParts[2] === "pull";
      } catch {
        return false;
      }
    },
    { message: "Submission URL must contain /pull/ segment" },
  )
  .refine(
    (url) => GITHUB_PR_URL_REGEX.test(url),
    { message: "Submission URL must follow format https://github.com/<owner>/<repo>/pull/<number>" },
  );

export function extractGithubPrRepo(submissionUrl: string): string | undefined {
  const parsedUrl = new URL(submissionUrl);
  const [owner, repo, segment] = parsedUrl.pathname.split("/").filter(Boolean);
  if (parsedUrl.hostname !== "github.com" || !owner || !repo || segment !== "pull") {
    return undefined;
  }
  return `${owner}/${repo}`;
}

/** Extract the PR number from a validated GitHub PR URL. */
function extractGithubPrNumber(submissionUrl: string): number | undefined {
  const parsedUrl = new URL(submissionUrl);
  const parts = parsedUrl.pathname.split("/").filter(Boolean);
  // parts: [owner, repo, "pull", number]
  if (parts.length < 4) return undefined;
  const num = parseInt(parts[3], 10);
  return isNaN(num) ? undefined : num;
}

/**
 * Cached result of a GitHub PR API verification.
 * Stored as JSON in the cache to avoid repeated API calls.
 */
interface PrVerificationResult {
  exists: boolean;
  /** Issue numbers referenced by the PR body (#N) or linked via the closing keyword. */
  closingIssueNumbers: number[];
}

/**
 * Call the GitHub API to verify a PR exists and retrieve its linked issue numbers.
 * Results are cached for `PR_CACHE_TTL_SECONDS` to reduce GitHub rate-limit usage.
 *
 * @param owner  - Repository owner (e.g. "ritik4ever")
 * @param repo   - Repository name (e.g. "stellar-bounty-board")
 * @param prNumber - Pull request number
 */
async function fetchPrFromGitHub(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PrVerificationResult> {
  const cacheKey = `github_pr:${owner}/${repo}/${prNumber}`;
  const cache = getCache();

  // Check cache first
  const cached = await cache.get(cacheKey);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as PrVerificationResult;
    } catch {
      // Corrupt cache entry — fall through to API call
    }
  }

  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "stellar-bounty-board",
  };
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;

  let result: PrVerificationResult;
  try {
    const res = await (globalThis as any).fetch(apiUrl, { headers });

    if (res.status === 404) {
      result = { exists: false, closingIssueNumbers: [] };
    } else if (!res.ok) {
      // For transient errors (rate-limit, 5xx) we do not cache — just return
      // the error so the caller can decide whether to treat as a hard failure.
      logStructured("warn", "github_pr_api_error", {
        owner,
        repo,
        prNumber,
        status: res.status,
      });
      throw new Error(`GitHub API returned HTTP ${res.status} for PR ${owner}/${repo}#${prNumber}`);
    } else {
      const json = await res.json();
      const body: string = typeof json.body === "string" ? json.body : "";

      // Extract issue numbers referenced by "closes #N", "fixes #N", "resolves #N", etc.
      const closingKeywordPattern = /(?:closes?|fixes?|resolves?)\s+#(\d+)/gi;
      const plainRefPattern = /#(\d+)/g;
      const referenced = new Set<number>();

      let match: RegExpExecArray | null;
      while ((match = closingKeywordPattern.exec(body)) !== null) {
        referenced.add(parseInt(match[1], 10));
      }
      // Also capture plain #N references in the body as a fallback
      while ((match = plainRefPattern.exec(body)) !== null) {
        referenced.add(parseInt(match[1], 10));
      }

      result = { exists: true, closingIssueNumbers: Array.from(referenced) };
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("GitHub API returned")) {
      throw err;
    }
    logStructured("warn", "github_pr_fetch_failed", {
      owner,
      repo,
      prNumber,
      error: String(err),
    });
    throw new Error(`Failed to reach GitHub API to verify PR ${owner}/${repo}#${prNumber}: ${String(err)}`);
  }

  // Cache the result (including "not found" results so we don't hammer the API)
  await cache.set(cacheKey, JSON.stringify(result), PR_CACHE_TTL_SECONDS);
  return result;
}

/**
 * Validate that a GitHub PR URL:
 * 1. Matches the expected format.
 * 2. Belongs to the same repository as the bounty.
 * 3. Actually exists on GitHub (live API call, result cached for 5 minutes).
 * 4. References the funded issue number in the PR body.
 *
 * If `GITHUB_TOKEN` is not set the API call is still made (unauthenticated, 60 req/hr limit).
 * When the GitHub API is unreachable the function throws so the submission is rejected rather
 * than silently accepted without verification.
 *
 * @param submissionUrl - The PR URL submitted by the contributor.
 * @param bountyRepo    - The owner/repo string from the bounty record.
 * @param issueNumber   - The GitHub issue number that the bounty funds.
 */
export async function validateGithubPrUrlForRepo(
  submissionUrl: string,
  bountyRepo: string,
  issueNumber?: number,
): Promise<void> {
  // Phase 1: format validation (synchronous, fast)
  githubPrUrlSchema.parse(submissionUrl);

  // Phase 2: repository match
  const prRepo = extractGithubPrRepo(submissionUrl);
  if (prRepo !== bountyRepo) {
    throw new Error(`Submission URL repository must match bounty repo ${bountyRepo}.`);
  }

  // Phase 3: GitHub API existence + issue reference check
  const prNumber = extractGithubPrNumber(submissionUrl);
  if (prNumber === undefined) {
    throw new Error("Could not extract PR number from submission URL.");
  }

  const [owner, repo] = bountyRepo.split("/");
  const verification = await fetchPrFromGitHub(owner, repo, prNumber);

  if (!verification.exists) {
    throw new Error(
      `Pull request ${submissionUrl} does not exist on GitHub. Please submit a valid PR link.`,
    );
  }

  // Phase 4: issue number cross-reference (only when an issue number is provided)
  if (issueNumber !== undefined) {
    const referencesIssue = verification.closingIssueNumbers.includes(issueNumber);
    if (!referencesIssue) {
      throw new Error(
        `Pull request ${submissionUrl} does not reference issue #${issueNumber}. ` +
          `Add "Closes #${issueNumber}" to the PR description to link it to this bounty.`,
      );
    }
  }
}
