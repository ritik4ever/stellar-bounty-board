export interface OpenIssue {
  id: string;
  title: string;
  labels: string[];
  summary: string;
  impact: "starter" | "core" | "advanced";
}

export type OpenIssuesFeedStatus = "up" | "rate-limited" | "stale";

export interface OpenIssuesFeedResult {
  issues: OpenIssue[];
  status: OpenIssuesFeedStatus;
}

interface GitHubIssue {
  number?: unknown;
  title?: unknown;
  body?: unknown;
  labels?: unknown[];
  pull_request?: unknown;
}

interface CacheEntry {
  issues: OpenIssue[];
  fetchedAt: number;
}

class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  peek(key: K): V | undefined {
    return this.entries.get(key);
  }

  set(key: K, value: V): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, value);

    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

const OPEN_ISSUES_CACHE_KEY = "github-open-issues";
export const OPEN_ISSUES_CACHE_TTL_MS = 10 * 60 * 1000;
const GITHUB_OPEN_ISSUES_URL =
  "https://api.github.com/repos/ritik4ever/stellar-bounty-board/issues" +
  "?state=open&labels=Stellar%20Wave&per_page=20";

const openIssuesCache = new LruCache<string, CacheEntry>(1);
let lastFeedStatus: OpenIssuesFeedStatus = "up";

const fallbackOpenIssues: OpenIssue[] = [
  {
    id: "SBB-101",
    title: "Add Freighter wallet signing for maintainer-only release and refund actions",
    labels: ["enhancement", "help wanted", "wallet"],
    summary:
      "Replace prompt-based demo actions with wallet-authenticated Soroban transactions so release and refund flows match real maintainer permissions.",
    impact: "core",
  },
  {
    id: "SBB-102",
    title: "Sync bounty submissions from GitHub pull request webhooks",
    labels: ["integration", "github", "help wanted"],
    summary:
      "Accept GitHub webhook events, connect PRs to bounty records, and auto-transition reserved bounties into submitted state.",
    impact: "advanced",
  },
  {
    id: "SBB-103",
    title: "Replace JSON persistence with Postgres and add an audit log table",
    labels: ["backend", "database", "help wanted"],
    summary:
      "Migrate from file storage to Postgres and preserve a complete history of status transitions for bounty payouts and refunds.",
    impact: "core",
  },
  {
    id: "SBB-104",
    title: "Add a contributor profile page with claim history and earnings",
    labels: ["frontend", "good first issue"],
    summary:
      "Show reserved, submitted, and released bounties per contributor with lifetime payout totals and filterable status chips.",
    impact: "starter",
  },
];

function extractLabelNames(labels: unknown[] | undefined): string[] {
  if (!Array.isArray(labels)) {
    return [];
  }
  return labels
    .map((label) => {
      if (typeof label === "string") {
        return label;
      }
      if (
        label &&
        typeof label === "object" &&
        "name" in label &&
        typeof (label as { name?: unknown }).name === "string"
      ) {
        return (label as { name: string }).name;
      }
      return undefined;
    })
    .filter((label): label is string => Boolean(label));
}

function inferImpact(labels: string[]): OpenIssue["impact"] {
  const normalized = labels.map((label) => label.toLowerCase());
  if (normalized.includes("good first issue") || normalized.includes("documentation")) {
    return "starter";
  }
  if (
    normalized.some((label) =>
      ["security", "devops", "performance", "smart contract"].includes(label),
    )
  ) {
    return "advanced";
  }
  return "core";
}

function summarizeIssue(body: unknown): string {
  if (typeof body !== "string") {
    return "Open contribution opportunity from the GitHub issue tracker.";
  }

  const summary = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
    .find((line) => line.length > 0);

  if (!summary) {
    return "Open contribution opportunity from the GitHub issue tracker.";
  }

  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
}

function toOpenIssue(issue: GitHubIssue): OpenIssue | null {
  if (issue.pull_request) {
    return null;
  }
  if (typeof issue.number !== "number" || typeof issue.title !== "string") {
    return null;
  }

  const labels = extractLabelNames(issue.labels);
  return {
    id: `#${issue.number}`,
    title: issue.title,
    labels,
    summary: summarizeIssue(issue.body),
    impact: inferImpact(labels),
  };
}

function cacheIsFresh(entry: CacheEntry, now = Date.now()): boolean {
  return now - entry.fetchedAt < OPEN_ISSUES_CACHE_TTL_MS;
}

function readFreshCache(): OpenIssuesFeedResult | null {
  const cached = openIssuesCache.get(OPEN_ISSUES_CACHE_KEY);
  if (cached && cacheIsFresh(cached)) {
    lastFeedStatus = "up";
    return { issues: cached.issues, status: "up" };
  }
  return null;
}

function readStaleCache(status: OpenIssuesFeedStatus): OpenIssuesFeedResult | null {
  const stale = openIssuesCache.peek(OPEN_ISSUES_CACHE_KEY);
  if (!stale) {
    return null;
  }
  lastFeedStatus = status;
  return { issues: stale.issues, status };
}

function githubRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "stellar-bounty-board-open-issues-feed",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

function isRateLimited(response: Response): boolean {
  return response.status === 403 || response.headers.get("X-RateLimit-Remaining") === "0";
}

export async function listOpenIssues(): Promise<OpenIssuesFeedResult> {
  const fresh = readFreshCache();
  if (fresh) {
    return fresh;
  }

  try {
    const response = await fetch(GITHUB_OPEN_ISSUES_URL, {
      headers: githubRequestHeaders(),
    });

    if (isRateLimited(response)) {
      const stale = readStaleCache("rate-limited");
      if (stale) {
        return stale;
      }
      lastFeedStatus = "rate-limited";
      return { issues: fallbackOpenIssues, status: "rate-limited" };
    }

    if (!response.ok) {
      throw new Error(`GitHub open issues request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const issues = Array.isArray(payload)
      ? payload
          .map((issue) => toOpenIssue(issue as GitHubIssue))
          .filter((issue): issue is OpenIssue => issue !== null)
      : [];

    const nextIssues = issues.length > 0 ? issues : fallbackOpenIssues;
    openIssuesCache.set(OPEN_ISSUES_CACHE_KEY, {
      issues: nextIssues,
      fetchedAt: Date.now(),
    });
    lastFeedStatus = "up";
    return { issues: nextIssues, status: "up" };
  } catch {
    const stale = readStaleCache("stale");
    if (stale) {
      return stale;
    }
    lastFeedStatus = "stale";
    return { issues: fallbackOpenIssues, status: "stale" };
  }
}

export function getOpenIssuesFeedStatus(): OpenIssuesFeedStatus {
  return lastFeedStatus;
}

export function resetOpenIssuesCacheForTests(): void {
  openIssuesCache.clear();
  lastFeedStatus = "up";
}

