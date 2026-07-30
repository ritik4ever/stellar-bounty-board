/**
 * In-memory deduplication store for GitHub webhook delivery IDs.
 *
 * GitHub guarantees at-least-once delivery, so the same event can arrive
 * more than once with an identical X-GitHub-Delivery ID.  This store tracks
 * delivery IDs we have already processed and returns early for duplicates,
 * preventing double-releases or other repeated side-effects.
 *
 * TTL mirrors the idempotency middleware (10 minutes) — long enough to absorb
 * GitHub's retry window, short enough to keep memory bounded.
 */

const DEDUP_TTL_MS = 10 * 60 * 1_000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

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
 * Returns `true` when `deliveryId` has already been processed and is still
 * within the TTL window, meaning the current delivery is a duplicate.
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
 * Records `deliveryId` as successfully processed.
 * Call this only after all side-effects for the delivery have completed.
 */
export function markAsProcessed(deliveryId: string): void {
  store.set(deliveryId, { processedAt: Date.now() });
}

/**
 * Clears the dedup store.  Intended for use in tests only.
 */
export function __resetDeliveryDedupStoreForTests(): void {
  store.clear();
}
