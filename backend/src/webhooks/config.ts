import { logger } from '../logger';

/**
 * Webhook configuration loaded from environment variables.
 * All values have documented defaults to guide operators.
 */
export interface WebhookConfig {
  /** Time-to-live for GitHub PR verification cache (seconds). Default: 300 (5 minutes). */
  prCacheTtlSeconds: number;
  /** Time-to-live for webhook delivery deduplication store (milliseconds). Default: 600000 (10 minutes). */
  dedupTtlMs: number;
  /** Cleanup interval for expired dedup entries (milliseconds). Default: 60000 (1 minute). */
  dedupCleanupIntervalMs: number;
}

/**
 * Reads and validates webhook configuration from environment variables.
 * Logs the effective values at startup for operator visibility.
 *
 * Environment variables:
 * - `WEBHOOK_PR_CACHE_TTL_SECONDS`: GitHub PR verification cache TTL (default: 300)
 * - `WEBHOOK_DEDUP_TTL_MS`: Delivery deduplication TTL in milliseconds (default: 600000)
 * - `WEBHOOK_DEDUP_CLEANUP_INTERVAL_MS`: Cleanup interval in milliseconds (default: 60000)
 *
 * @returns Webhook configuration with validated values or defaults.
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
