/**
 * Application-level operational configuration for app.ts (#1298).
 *
 * Sourced from environment variables with safe, defensive defaults.
 * Allows operators to tune pagination bounds, rate limiting, payload limits,
 * and HTTP Cache-Control headers without modifying code or redeploying.
 */

export interface AppConfig {
  /** Rate limit window in milliseconds (default: 60000 = 1 minute). */
  rateLimitWindowMs: number;
  /** Maximum read requests per window (default: 120). */
  rateLimitReadMax: number;
  /** Maximum mutation requests per window (default: 10). */
  rateLimitMutationMax: number;
  /** Maximum release requests per window (default: 10). */
  rateLimitReleaseMax: number;
  /** Rate limit window in milliseconds for release endpoint (default: 60000 = 1 minute). */
  rateLimitReleaseWindowMs: number;
  /** Maximum submit requests per window (default: 10). */
  rateLimitSubmitMax: number;
  /** Rate limit window in milliseconds for submit endpoint (default: 60000 = 1 minute). */
  rateLimitSubmitWindowMs: number;
  /** Maximum refund requests per window (default: 10). */
  rateLimitRefundMax: number;
  /** Rate limit window in milliseconds for refund endpoint (default: 60000 = 1 minute). */
  rateLimitRefundWindowMs: number;
  /** Maximum open issues requests per window (default: 30). */
  rateLimitOpenIssuesMax: number;
  /** Rate limit window in milliseconds for open issues endpoint (default: 60000 = 1 minute). */
  rateLimitOpenIssuesWindowMs: number;
  /** Maximum bounties list requests per window (default: 60). */
  rateLimitBountiesMax: number;
  /** Rate limit window in milliseconds for bounties list endpoint (default: 60000 = 1 minute). */
  rateLimitBountiesWindowMs: number;
  /** Default pagination limit for list endpoints (default: 20). */
  defaultPageSize: number;
  /** Maximum allowable pagination limit for list endpoints (default: 100). */
  maxPageSize: number;
  /** Default limit for leaderboard ranking queries (default: 10). */
  defaultLeaderboardLimit: number;
  /** Maximum payload size for CSV batch imports (default: '1mb'). */
  csvUploadLimit: string;
  /** Maximum payload size for raw body capture / webhooks (default: '256kb'). */
  rawBodyLimit: string;
  /** Cache-Control max-age in seconds for open issues feed (default: 600). */
  openIssuesCacheSeconds: number;
  /** Cache-Control max-age in seconds for public bounties board (default: 5). */
  bountiesListCacheSeconds: number;
  /** Cache-Control max-age in seconds for public config endpoint (default: 300). */
  configCacheSeconds: number;
  /** Cache-Control stale-while-revalidate in seconds for config endpoint (default: 60). */
  configStaleWhileRevalidateSeconds: number;
}

function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val?.trim()) return fallback;
  const num = Number(val.trim());
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function parseString(val: string | undefined, fallback: string): string {
  if (!val?.trim()) return fallback;
  return val.trim();
}

export function getAppConfig(): AppConfig {
  return {
    rateLimitWindowMs: parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitReadMax: parsePositiveInt(process.env.RATE_LIMIT_READ_MAX, 120),
    rateLimitMutationMax: parsePositiveInt(process.env.RATE_LIMIT_MUTATION_MAX, 10),
    rateLimitReleaseMax: parsePositiveInt(process.env.RATE_LIMIT_RELEASE_MAX, 10),
    rateLimitReleaseWindowMs: parsePositiveInt(process.env.RATE_LIMIT_RELEASE_WINDOW_MS, 60_000),
    rateLimitSubmitMax: parsePositiveInt(process.env.RATE_LIMIT_SUBMIT_MAX, 10),
    rateLimitSubmitWindowMs: parsePositiveInt(process.env.RATE_LIMIT_SUBMIT_WINDOW_MS, 60_000),
    rateLimitRefundMax: parsePositiveInt(process.env.RATE_LIMIT_REFUND_MAX, 10),
    rateLimitRefundWindowMs: parsePositiveInt(process.env.RATE_LIMIT_REFUND_WINDOW_MS, 60_000),
    rateLimitOpenIssuesMax: parsePositiveInt(process.env.RATE_LIMIT_OPEN_ISSUES_MAX, 30),
    rateLimitOpenIssuesWindowMs: parsePositiveInt(
      process.env.RATE_LIMIT_OPEN_ISSUES_WINDOW_MS,
      60_000
    ),
    rateLimitBountiesMax: parsePositiveInt(process.env.RATE_LIMIT_BOUNTIES_MAX, 60),
    rateLimitBountiesWindowMs: parsePositiveInt(
      process.env.RATE_LIMIT_BOUNTIES_WINDOW_MS,
      60_000
    ),
    defaultPageSize: parsePositiveInt(process.env.DEFAULT_PAGE_SIZE, 20),
    maxPageSize: parsePositiveInt(process.env.MAX_PAGE_SIZE, 100),
    defaultLeaderboardLimit: parsePositiveInt(process.env.DEFAULT_LEADERBOARD_LIMIT, 10),
    csvUploadLimit: parseString(process.env.CSV_UPLOAD_LIMIT, '1mb'),
    rawBodyLimit: parseString(process.env.RAW_BODY_LIMIT, '256kb'),
    openIssuesCacheSeconds: parsePositiveInt(process.env.OPEN_ISSUES_CACHE_SECONDS, 600),
    bountiesListCacheSeconds: parsePositiveInt(process.env.BOUNTIES_LIST_CACHE_SECONDS, 5),
    configCacheSeconds: parsePositiveInt(process.env.CONFIG_CACHE_SECONDS, 300),
    configStaleWhileRevalidateSeconds: parsePositiveInt(
      process.env.CONFIG_STALE_WHILE_REVALIDATE_SECONDS,
      60
    ),
  };
}
