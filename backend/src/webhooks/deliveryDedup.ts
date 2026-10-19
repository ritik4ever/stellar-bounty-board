import { getWebhookConfig } from './config';

/**
 * In-memory deduplication store for GitHub webhook delivery IDs.
 *
 * **Purpose:**
 * GitHub guarantees at-least-once delivery, meaning the same event can arrive
 * more than once with an identical `X-GitHub-Delivery` ID. This module tracks
 * delivery IDs we have already processed and prevents duplicate side-effects
 * (e.g., double-releases, duplicate audit log entries).
 *
 * **Configuration:**
 * TTL and cleanup intervals are read from environment configuration via
 * {@link getWebhookConfig}:
 * - `WEBHOOK_DEDUP_TTL_MS`: Deduplication TTL in milliseconds (default: 600000 / 10 minutes)
 * - `WEBHOOK_DEDUP_CLEANUP_INTERVAL_MS`: Cleanup interval in milliseconds (default: 60000 / 1 minute)
 *
 * **Behavior:**
 * - Call {@link hasBeenProcessed} at the start of webhook handling to check for duplicates.
 * - Call {@link markAsProcessed} after all side-effects are complete to record the delivery.
 * - Expired entries are automatically cleaned up on an interval (unref'd to not keep process alive).
 * - All operations are synchronous and in-process (no external I/O).
 *
 * **Concurrency:**
 * - Synchronous, in-process store (no concurrent safety issues beyond Node event loop).
 * - Each delivery is handled in a single request context (one thread).
 * - Cleanup runs periodically and independently.
 *
 * **Limitations:**
 * - Does not survive process restarts (memory-only storage).
 * - Only suitable for single-process deployments. For multi-process/multi-server,
 *   migrate to Redis-backed deduplication.
 *
 * **Example:**
 * ```ts
 * if (hasBeenProcessed(deliveryId)) {
 *   return { duplicate: true };
 * }
 *
 * // ... process webhook, mutate state, etc.
 *
 * markAsProcessed(deliveryId);
 * return { duplicate: false };
 * ```
 */

const config = getWebhookConfig();
const DEDUP_TTL_MS = config.dedupTtlMs;
const CLEANUP_INTERVAL_MS = config.dedupCleanupIntervalMs;

interface DeliveryEntry {
  processedAt: number;
}

const store = new Map<string, DeliveryEntry>();

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - DEDUP_TTL_MS;
  for (const [id, entry] of store) {
    if (entry.processedAt < cutoff) {
      store.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS);

// Don't keep the process alive just for cleanup
cleanupTimer.unref();

/**
 * Checks whether a delivery ID has already been processed.
 *
 * Returns `true` if the delivery ID is in the store and still within the TTL window
 * (not expired). Returns `false` if the ID is not in the store or has expired.
 *
 * Expired entries are automatically removed (lazily) when checked.
 *
 * **Synchronous, no I/O.** Never throws.
 *
 * @param deliveryId - The GitHub delivery ID from the `X-GitHub-Delivery` header.
 * @returns `true` if this delivery has been processed recently (still within TTL),
 *          `false` if this is a new or expired delivery.
 *
 * **Concurrency:** Synchronous and read-only (except for lazy cleanup of expired entries).
 * Safe to call concurrently.
 */
export function hasBeenProcessed(deliveryId: string): boolean {
  const entry = store.get(deliveryId);
  if (!entry) return false;
  if (Date.now() - entry.processedAt >= DEDUP_TTL_MS) {
    store.delete(deliveryId);
    return false;
  }
  return true;
}

/**
 * Records a delivery ID as successfully processed.
 *
 * Call this only after all side-effects for the delivery have completed
 * (state mutations, database writes, etc.). The delivery ID is stored with
 * the current timestamp and will be considered a duplicate for the next
 * {@link getWebhookConfig}.dedupTtlMs milliseconds.
 *
 * **Synchronous, no I/O.** Never throws.
 *
 * @param deliveryId - The GitHub delivery ID from the `X-GitHub-Delivery` header.
 *
 * **Concurrency:** Synchronous write. Safe with concurrent requests because
 * each request has its own delivery ID.
 */
export function markAsProcessed(deliveryId: string): void {
  store.set(deliveryId, { processedAt: Date.now() });
}

/**
 * Clears the entire deduplication store.
 *
 * **This is intended for testing only.** Calling this in production will lose
 * all duplicate detection state until new deliveries are processed.
 *
 * **Synchronous, no I/O.** Never throws.
 *
 * @internal
 *
 * **Concurrency:** Synchronous. Use only in single-threaded test environments.
 */
export function __resetDeliveryDedupStoreForTests(): void {
  store.clear();
}
