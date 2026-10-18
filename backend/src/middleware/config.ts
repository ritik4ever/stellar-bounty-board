/**
 * Operational configuration for backend middleware.
 *
 * Sourced from environment variables with safe defaults.
 * Allows operators to tune thresholds, timeouts, and rate limits
 * without code changes or redeployments.
 */

export interface MiddlewareConfig {
  /** Default body size limit for standard routes (e.g., '32kb'). Source: DEFAULT_BODY_LIMIT */
  defaultBodyLimit: string;

  /** Large body size limit for payload-heavy routes (e.g., '256kb'). Source: LARGE_BODY_LIMIT */
  largeBodyLimit: string;

  /** Time-to-live for idempotency cache entries in ms. Source: IDEMPOTENCY_TTL_MS (default: 600,000 = 10m) */
  idempotencyTtlMs: number;

  /** Interval between cleanup sweeps for expired idempotency entries in ms. Source: IDEMPOTENCY_CLEANUP_INTERVAL_MS (default: 60,000 = 1m) */
  idempotencyCleanupIntervalMs: number;

  /** Max requests per window for maintainer bounty creation. Source: MAINTAINER_BOUNTY_RATE_LIMIT (default: 10) */
  maintainerRateLimit: number;

  /** Rolling window duration for maintainer rate limit in ms. Source: MAINTAINER_BOUNTY_RATE_WINDOW_MS (default: 3,600,000 = 1h) */
  maintainerRateWindowMs: number;

  /** Retry count when acquiring file lock for maintainer rate limit store. Source: MAINTAINER_LOCK_RETRIES (default: 5) */
  maintainerLockRetries: number;

  /** Minimum backoff timeout (ms) for file lock retries. Source: MAINTAINER_LOCK_MIN_TIMEOUT_MS (default: 10) */
  maintainerLockMinTimeoutMs: number;

  /** Maximum backoff timeout (ms) for file lock retries. Source: MAINTAINER_LOCK_MAX_TIMEOUT_MS (default: 50) */
  maintainerLockMaxTimeoutMs: number;

  /** Stale lock threshold (ms) after which a lock is treated as dead. Source: MAINTAINER_LOCK_STALE_MS (default: 5000) */
  maintainerLockStaleMs: number;
}

/**
 * Returns the effective middleware configuration.
 * Never throws — malformed or out-of-range inputs fall back to documented defaults.
 */
export function getMiddlewareConfig(): MiddlewareConfig {
  const defaultBodyLimit = process.env.DEFAULT_BODY_LIMIT?.trim() || '32kb';
  const largeBodyLimit = process.env.LARGE_BODY_LIMIT?.trim() || '256kb';

  const idempotencyTtlMs = (() => {
    const raw = Number(process.env.IDEMPOTENCY_TTL_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10 * 60 * 1000;
  })();

  const idempotencyCleanupIntervalMs = (() => {
    const raw = Number(process.env.IDEMPOTENCY_CLEANUP_INTERVAL_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 60_000;
  })();

  const maintainerRateLimit = (() => {
    const raw = Number(process.env.MAINTAINER_BOUNTY_RATE_LIMIT);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
  })();

  const maintainerRateWindowMs = (() => {
    const raw = Number(process.env.MAINTAINER_BOUNTY_RATE_WINDOW_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3600_000;
  })();

  const maintainerLockRetries = (() => {
    const raw = Number(process.env.MAINTAINER_LOCK_RETRIES);
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 5;
  })();

  const maintainerLockMinTimeoutMs = (() => {
    const raw = Number(process.env.MAINTAINER_LOCK_MIN_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
  })();

  const maintainerLockMaxTimeoutMs = (() => {
    const raw = Number(process.env.MAINTAINER_LOCK_MAX_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
  })();

  const maintainerLockStaleMs = (() => {
    const raw = Number(process.env.MAINTAINER_LOCK_STALE_MS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5000;
  })();

  return {
    defaultBodyLimit,
    largeBodyLimit,
    idempotencyTtlMs,
    idempotencyCleanupIntervalMs,
    maintainerRateLimit,
    maintainerRateWindowMs,
    maintainerLockRetries,
    maintainerLockMinTimeoutMs,
    maintainerLockMaxTimeoutMs,
    maintainerLockStaleMs,
  };
}
