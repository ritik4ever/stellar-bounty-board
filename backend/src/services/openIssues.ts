/**
 * Public interface for representing a GitHub issue available as an open bounty.
 */
export interface OpenIssue {
  /** Unique GitHub issue identifier in "GH-{number}" format. */
  id: string;
  /** GitHub issue title. */
  title: string;
  /** Array of GitHub label strings assigned to the issue. */
  labels: string[];
  /** First paragraph of the issue description (extracted from body). */
  summary: string;
  /** Difficulty/complexity level of the issue ("starter", "core", or "advanced"). */
  impact: "starter" | "core" | "advanced";
}

type FeedStatus = "up" | "rate-limited" | "stale";

const DEFAULT_REPO = "ritik4ever/stellar-bounty-board";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

class LRUCache<K, V> {
  private max: number;
  private map = new Map<K, { value: V; expiresAt: number }>();

  constructor(max = 10) {
    this.max = max;
  }

  get(key: K): V | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    // mark as recently used
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number): void {
    if (this.map.has(key)) this.map.delete(key);
    while (this.map.size >= this.max) {
      const first = this.map.keys().next().value as K;
      this.map.delete(first);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

const cache = new LRUCache<string, OpenIssue[]>(10);
let cachedKey = "open_issues";
let lastStatus: FeedStatus = "up";

function mapIssueToOpenIssue(i: any): OpenIssue {
  return {
    id: `GH-${i.number}`,
    title: i.title ?? "",
    labels: Array.isArray(i.labels)
      ? i.labels.map((l: any) => (typeof l === "string" ? l : l.name)).filter(Boolean)
      : [],
    summary: typeof i.body === "string" ? i.body.split("\n\n")[0] : "",
    impact: "starter",
  };
}

/**
 * Get the current health status of the open issues feed.
 *
 * Returns the status of the last fetch operation:
 * - "up": Feed was successfully fetched and cached
 * - "rate-limited": GitHub API rate limit was hit; stale cache (if any) is being used
 * - "stale": Feed could not be fetched; returning cached data from a previous request
 *
 * @returns {FeedStatus} The current feed status ("up", "rate-limited", or "stale")
 */
export function getOpenIssuesStatus(): FeedStatus {
  return lastStatus;
}

/**
 * Fetch and return a list of open GitHub issues from the configured repository.
 *
 * Issues are fetched from GitHub API and cached for 10 minutes. If the GitHub API
 * is rate-limited or unreachable, a stale cached result (if available) is returned.
 * Respects GITHUB_TOKEN and OPEN_ISSUES_REPO environment variables for authentication
 * and repository selection.
 *
 * @returns {Promise<OpenIssue[]>} Array of open issues, or empty array if fetch fails
 *   and no cache is available
 * @throws {Error} Only if fetch fails AND no stale cache is available
 * @note Call {@link getOpenIssuesStatus} after this to determine feed health
 */
export async function listOpenIssues(): Promise<OpenIssue[]> {
  const existing = cache.get(cachedKey);
  if (existing) return existing;

  const repo = process.env.OPEN_ISSUES_REPO ?? DEFAULT_REPO;
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (token) headers.Authorization = `token ${token}`;

  try {
    const res = await (globalThis as any).fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=30`, {
      headers,
    });

    const remaining = res.headers?.get?.("x-ratelimit-remaining");
    if (res.status === 403 || (remaining !== null && Number(remaining) === 0)) {
      lastStatus = "rate-limited";
      const fromCache = cache.get(cachedKey);
      if (fromCache) {
        lastStatus = "stale";
        return fromCache;
      }
      return [];
    }

    if (!res.ok) {
      const fromCache = cache.get(cachedKey);
      if (fromCache) {
        lastStatus = "stale";
        return fromCache;
      }
      throw new Error(`GitHub API returned ${res.status}`);
    }

    const json = await res.json();
    const items = Array.isArray(json) ? json.filter((it) => !it.pull_request).map(mapIssueToOpenIssue) : [];
    cache.set(cachedKey, items, CACHE_TTL_MS);
    lastStatus = "up";
    return items;
  } catch (err) {
    const fromCache = cache.get(cachedKey);
    if (fromCache) {
      lastStatus = "stale";
      return fromCache;
    }
    throw err;
  }
}

/**
 * Get the current health status of the open issues feed (alias for {@link getOpenIssuesStatus}).
 *
 * Returns the status of the last fetch operation:
 * - "up": Feed was successfully fetched and cached
 * - "rate-limited": GitHub API rate limit was hit; stale cache (if any) is being used
 * - "stale": Feed could not be fetched; returning cached data from a previous request
 *
 * @returns {"up" | "rate-limited" | "stale"} The current feed status
 * @deprecated Prefer {@link getOpenIssuesStatus} instead
 */
export function getOpenIssuesFeedStatus(): "up" | "rate-limited" | "stale" {
  return lastStatus;
}

