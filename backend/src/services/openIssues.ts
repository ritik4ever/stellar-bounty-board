export interface OpenIssue {
  id: string;
  title: string;
  labels: string[];
  summary: string;
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

export function getOpenIssuesStatus(): FeedStatus {
  return lastStatus;
}

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

export function getOpenIssuesFeedStatus(): "up" | "rate-limited" | "stale" {
  return lastStatus;
}

