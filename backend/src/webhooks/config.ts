import { logger } from '../logger';

/**
 * Webhook configuration loaded from environment variables.
 *
 * All values have documented defaults and are validated at startup to guide operators.
 * See {@link getWebhookConfig} for detailed environment variable documentation.
 */
export interface WebhookConfig {
  /**
   * Time-to-live for GitHub PR verification cache (seconds).
   *
   * Source: `WEBHOOK_PR_CACHE_TTL_SECONDS`
   * Default: `300` (5 minutes)
   */
  prCacheTtlSeconds: number;
  /**
   * Time-to-live for webhook delivery deduplication store (milliseconds).
   *
   * Source: `WEBHOOK_DEDUP_TTL_MS`
   * Default: `600000` (10 minutes)
   */
  dedupTtlMs: number;
  /**
   * Cleanup interval for expired dedup entries (milliseconds).
   *
   * Source: `WEBHOOK_DEDUP_CLEANUP_INTERVAL_MS`
   * Default: `60000` (1 minute)
   */
  dedupCleanupIntervalMs: number;
}

/**
 * Reads and validates webhook configuration from environment variables.
 *
 * **Environment variables:**
 * - `WEBHOOK_PR_CACHE_TTL_SECONDS`: GitHub PR verification cache TTL in seconds
 *   (default: 300 seconds = 5 minutes)
 * - `WEBHOOK_DEDUP_TTL_MS`: Delivery deduplication store TTL in milliseconds
 *   (default: 600000 ms = 10 minutes)
 * - `WEBHOOK_DEDUP_CLEANUP_INTERVAL_MS`: Cleanup interval in milliseconds
 *   (default: 60000 ms = 1 minute)
 *
 * **Validation:**
 * - All values must be finite positive numbers or are reset to their defaults.
 * - Invalid values are logged as warnings; no error is thrown.
 * - Values are floored to the nearest integer.
 *
 * **Startup behavior:**
 * - Logs the effective configuration values at `info` level for operator visibility.
 * - Never throws, even if all env vars are malformed.
 *
 * **Concurrency:**
 * - Synchronous, side-effect free (except for the startup log).
 * - Reads `process.env` fresh on every call; results are not cached.
 * - If environment variables are mutated while the process runs (e.g., in tests),
 *   successive calls reflect those changes.
 * - Safe to call concurrently (each call is independent).
 *
 * @returns A {@link WebhookConfig} object with validated values or defaults.
 *   All fields are always populated (never `null` / `undefined`).
 *
 * @example
 * ```ts
 * const config = getWebhookConfig();
 * console.log(config.prCacheTtlSeconds); // 300 (default or env override)
 * console.log(config.dedupTtlMs); // 600000 (default or env override)
 * ```
 *
 * @remarks
 * Called at module level in {@link deliveryDedup.ts} to initialize the deduplication
 * store's TTL and cleanup interval. Also called by {@link prUrl.ts} to initialize
 * the GitHub PR verification cache TTL.
 */
export function getWebhookConfig(): WebhookConfig {
  const prCacheTtlSeconds = (() => {
    const raw = process.env.WEBHOOK_PR_CACHE_TTL_SECONDS;
    if (!raw) return 300; // 5 minutes
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      logger.warn(
        { value: raw },
        'WEBHOOK_PR_CACHE_TTL_SECONDS must be a positive number; using default 300 seconds',
      );
      return 300;
    }
    return Math.floor(parsed);
  })();

  const dedupTtlMs = (() => {
    const raw = process.env.WEBHOOK_DEDUP_TTL_MS;
    if (!raw) return 10 * 60 * 1000; // 10 minutes
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      logger.warn(
        { value: raw },
        'WEBHOOK_DEDUP_TTL_MS must be a positive number; using default 600000 milliseconds',
      );
      return 10 * 60 * 1000;
    }
    return Math.floor(parsed);
  })();

  const dedupCleanupIntervalMs = (() => {
    const raw = process.env.WEBHOOK_DEDUP_CLEANUP_INTERVAL_MS;
    if (!raw) return 60000; // 1 minute
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      logger.warn(
        { value: raw },
        'WEBHOOK_DEDUP_CLEANUP_INTERVAL_MS must be a positive number; using default 60000 milliseconds',
      );
      return 60000;
    }
    return Math.floor(parsed);
  })();

  const config: WebhookConfig = {
    prCacheTtlSeconds,
    dedupTtlMs,
    dedupCleanupIntervalMs,
  };

  // Log effective values at startup for operator visibility
  logger.info(config, 'Webhook configuration loaded (WEBHOOK_PR_CACHE_TTL_SECONDS, WEBHOOK_DEDUP_TTL_MS, WEBHOOK_DEDUP_CLEANUP_INTERVAL_MS)');

  return config;
}
