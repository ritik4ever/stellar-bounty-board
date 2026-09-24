import { z } from "zod";
import { getCache } from "../services/cache";
import { logStructured } from "../logger";

const GITHUB_PR_URL_REGEX = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+$/;

/** TTL for caching GitHub PR verification results (5 minutes). */
const PR_CACHE_TTL_SECONDS = 5 * 60;

/**
 * Zod schema for a GitHub pull request URL of the exact form
 * `https://github.com/<owner>/<repo>/pull/<number>` (after trimming).
 *
 * Rejects other hosts (including `www.github.com`), `http:`, missing `/pull/`,
 * trailing slashes, query strings, fragments, and extra path segments such as
 * `/files`. Owner and repo may contain `[a-zA-Z0-9_.-]`.
 *
 * Purely syntactic: it does not check that the PR exists or which repository
 * it belongs to (see {@link validateGithubPrUrlForRepo}). A bad URL can
 * produce more than one issue, because the refinements run independently.
 *
 * `parse` throws a `ZodError`; `safeParse` never throws. Stateless.
 */
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

/**
 * Extracts `owner/repo` from a GitHub pull request URL.
 *
 * Only the first three path segments are checked, so the URL does not need to
 * pass {@link githubPrUrlSchema}. For example `.../pull/abc` still returns the
 * repo, and query strings are ignored. Case is preserved; nothing is looked up
 * on GitHub.
 *
 * @param submissionUrl - An absolute URL string.
 * @returns `"owner/repo"`, or `undefined` if the host is not exactly
 *   `github.com` or the third path segment is not `pull`.
 * @throws {TypeError} If `submissionUrl` is not a parseable absolute URL
 *   (thrown by `new URL`). Validate with {@link githubPrUrlSchema} first if the
 *   input is untrusted.
 */
export function extractGithubPrRepo(submissionUrl: string): string | undefined {
  const parsedUrl = new URL(submissionUrl);
  const [owner, repo, segment] = parsedUrl.pathname.split("/").filter(Boolean);
  if (parsedUrl.hostname !== "github.com" || !owner || !repo || segment !== "pull") {
    return undefined;
  }
  return `${owner}/${repo}`;
}

/** Extract the PR number from a validated GitHub PR URL. */
export function extractGithubPrNumber(submissionUrl: string): number | undefined {
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
export interface PrVerificationResult {
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
export async function fetchPrFromGitHub(
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
      const closingKeywordPattern = /(?:closes?|closed|fixes?|fixed|resolves?|resolved)\s+(?:[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)?#(\d+)/gi;
      const plainRefPattern = /#(\d+)/g;
      const issueUrlPattern = /\/issues\/(\d+)/g;
      const referenced = new Set<number>();

      let match: RegExpExecArray | null;
      while ((match = closingKeywordPattern.exec(body)) !== null) {
        referenced.add(parseInt(match[1], 10));
      }
      while ((match = plainRefPattern.exec(body)) !== null) {
        referenced.add(parseInt(match[1], 10));
      }
      while ((match = issueUrlPattern.exec(body)) !== null) {
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
 * The function is `async`, so every failure below arrives as a **rejected
 * promise**, never as a synchronous throw. Callers must `await` it; wrapping
 * the call in `expect(() => ...).toThrow()` or a sync `try` catches nothing.
 * It never resolves with a value, and it never returns `false` or `null` to
 * signal failure.
 *
 * Notes:
 *  - The repo comparison is exact and case-sensitive: `Owner/Repo` does not
 *    match `owner/repo`.
 *  - The issue check passes if the PR body contains `#<issueNumber>` anywhere,
 *    not only after a closing keyword such as `Closes`. `#12` does not match
 *    `#123`.
 *  - Cache failures (e.g. Redis down) count as a cache miss and never cause a
 *    rejection.
 *
 * Concurrency: results are cached for 5 minutes in the shared cache adapter
 * (in-process memory, or Redis when `REDIS_URL` is set). "Not found" is cached
 * too, so a PR opened within 5 minutes of a failed check stays rejected until
 * the entry expires. Transient GitHub errors are not cached. There is no
 * request coalescing, so concurrent calls for the same uncached PR each call
 * the GitHub API.
 *
 * @param submissionUrl - The PR URL submitted by the contributor.
 * @param bountyRepo    - The owner/repo string from the bounty record.
 * @param issueNumber   - The GitHub issue number that the bounty funds. When
 *   omitted, the issue-reference check (phase 4) is skipped.
 * @returns Resolves with `undefined` when every check passes.
 * @throws {z.ZodError} If `submissionUrl` fails {@link githubPrUrlSchema}.
 *   Nothing is fetched in that case.
 * @throws {Error} "Submission URL repository must match bounty repo ..." when
 *   the PR's `owner/repo` differs from `bountyRepo`.
 * @throws {Error} "GitHub API returned HTTP <status> ..." for any non-404
 *   error status (401, 403 rate limit, 5xx). Not cached.
 * @throws {Error} "Failed to reach GitHub API ..." on network failure or an
 *   unparseable response body. Not cached.
 * @throws {Error} "Pull request ... does not exist on GitHub ..." when GitHub
 *   returns 404 (cached).
 * @throws {Error} "Pull request ... does not reference issue #N ..." when
 *   `issueNumber` is given and the PR body does not mention it.
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
