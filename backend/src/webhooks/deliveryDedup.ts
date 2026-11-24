import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';
import { getWebhookConfig } from './config';

/**
 * Persistent delivery journal for GitHub webhook deliveries.
 *
 * **Purpose:**
 * GitHub delivers each webhook event at least once with an `X-GitHub-Delivery`
 * ID, but the process handling it can be interrupted at any point: the HTTP
 * handler can crash mid-flight, the container can be restarted, or a
 * downstream dependency (the bounty store) can be temporarily unavailable.
 * A purely in-memory deduplication set loses all knowledge of a delivery when
 * that happens, which makes retries unsafe:
 *
 * - If the delivery is remembered as "done" after a partial run, the retry is
 *   skipped and the committed effects are **lost**.
 * - If it is not remembered at all, the retry replays side effects and the
 *   committed effects are **duplicated**.
 *
 * This module therefore keeps a small journal on disk and models each delivery
 * as a three-state record:
 *
 * | Status        | Meaning                                                         |
 * | ------------- | --------------------------------------------------------------- |
 * | `in_progress` | A worker claimed the delivery and is applying side effects.     |
 * | `pending`     | Processing could not complete (no matching bounty yet, error).  |
 * | `completed`   | All side effects for this delivery finished successfully.        |
 *
 * A retry of a `completed` delivery inside the TTL window is a duplicate and is
 * skipped. A retry of an `in_progress` or `pending` record is **resumed**, so a
 * delivery interrupted mid-flight is re-driven instead of dropped.
 *
 * **Durability:**
 * - The journal is written with a temp-file + atomic rename, so a crash during
 *   the write leaves either the previous or the new journal, never a torn file.
 * - A missing, empty, or corrupt journal is treated as empty (logged at `warn`)
 *   rather than crashing the webhook route.
 * - The journal only stores delivery metadata (status, attempt count, PR URL).
 *   The authoritative state of a bounty still lives in the bounty store, which
 *   guards every transition with a store-wide lock. Re-running a resumed
 *   delivery is therefore idempotent: already-applied transitions are detected
 *   and skipped rather than applied twice.
 *
 * **Configuration:**
 * - `WEBHOOK_DELIVERY_STORE_PATH`: journal file (default: alongside the bounty
 *   store, e.g. `data/bounties.webhook-deliveries.json`).
 * - `WEBHOOK_DEDUP_TTL_MS`: how long a `completed` record suppresses duplicate
 *   deliveries (default: 10 minutes).
 * - `WEBHOOK_DELIVERY_CLAIM_STALE_MS`: how long an unfinished record is kept so
 *   it can be resumed before it is pruned (default: 24 hours).
 * - `WEBHOOK_DEDUP_CLEANUP_INTERVAL_MS`: how often expired records are pruned
 *   in the background (default: 1 minute).
 *
 * **Concurrency / multi-process:**
 * - Every operation re-reads the journal from disk and writes the merged result
 *   atomically, so a second process sees deliveries claimed by the first.
 * - The journal is intentionally *not* a distributed lock. Two processes may
 *   race on the same delivery; the bounty store's lock plus the
 *   `status === 'submitted'` guard in `releaseBounty` ensure only one of them
 *   commits the release, and the other treats "already released" as success.
 *
 * **Example:**
 * ```ts
 * const claim = beginDelivery(deliveryId, { prUrl });
 * if (claim.decision === 'duplicate') return { duplicate: true };
 *
 * try {
 *   await applySideEffects();
 *   markAsProcessed(deliveryId);
 * } catch (error) {
 *   deferDelivery(deliveryId, { prUrl, reason: 'transient_error' });
 *   throw error;
 * }
 * ```
 */

/** Processing state of a single webhook delivery. */
export type DeliveryStatus = 'in_progress' | 'pending' | 'completed';

/** Metadata captured when a delivery is claimed. */
export interface DeliveryMeta {
  /** PR URL extracted from the payload, stored so the delivery can be resumed after a restart. */
  prUrl?: string;
  /** Reason a delivery was deferred, for operator visibility. */
  reason?: string;
}

/** A persisted delivery journal record. */
export interface DeliveryEntry {
  /** Current processing state of the delivery. */
  status: DeliveryStatus;
  /** Number of times this delivery has been claimed (including resumes). */
  attempts: number;
  /** Epoch milliseconds when the delivery was first seen. */
  firstSeenAt: number;
  /** Epoch milliseconds of the last state change (also the TTL anchor). */
  updatedAt: number;
  /** Last known PR URL, used to resume processing after an interruption. */
  lastPrUrl?: string;
  /** Last known reason the delivery could not complete. */
  lastReason?: string;
}

/** Outcome of claiming a delivery ID. */
export type DeliveryDecision = 'new' | 'resume' | 'duplicate';

/** Result of {@link beginDelivery}. */
export interface DeliveryClaim {
  /** Whether the delivery is new, a resumed retry, or an already-completed duplicate. */
  decision: DeliveryDecision;
  /** The delivery ID that was claimed. */
  deliveryId: string;
  /** Attempt count after this claim. */
  attempts: number;
  /** Epoch milliseconds when this delivery ID was first seen. */
  firstSeenAt: number;
}

/** A delivery that still needs to be processed. */
export interface PendingDelivery {
  /** GitHub `X-GitHub-Delivery` ID. */
  deliveryId: string;
  /** Current state (`in_progress` or `pending`). */
  status: Exclude<DeliveryStatus, 'completed'>;
  /** Attempt count so far. */
  attempts: number;
  /** PR URL captured when the delivery was claimed, if any. */
  prUrl?: string;
  /** Why the delivery is still pending, if known. */
  reason?: string;
  /** Epoch milliseconds when the delivery was first seen. */
  firstSeenAt: number;
}

interface JournalFile {
  version: number;
  deliveries: Record<string, DeliveryEntry>;
}

const JOURNAL_VERSION = 1;

const config = getWebhookConfig();
/** How long a completed delivery suppresses redeliveries. */
const DEDUP_TTL_MS = config.dedupTtlMs;
/** How long an unfinished delivery is retained so it can be resumed. */
const CLAIM_STALE_MS = config.deliveryClaimStaleMs;
/** Background prune cadence for the on-disk journal. */
const CLEANUP_INTERVAL_MS = config.dedupCleanupIntervalMs;

/**
 * Resolves the journal file path.
 *
 * `WEBHOOK_DELIVERY_STORE_PATH` wins when set; otherwise the journal is stored
 * next to the bounty store so both survive the same volume mount.
 *
 * **Synchronous, reads `process.env` on every call.** Never throws.
 */
export function getDeliveryJournalPath(): string {
  const explicit = process.env.WEBHOOK_DELIVERY_STORE_PATH?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const bountyStorePath = process.env.BOUNTY_STORE_PATH?.trim()
    ? path.resolve(process.env.BOUNTY_STORE_PATH.trim())
    : path.resolve(__dirname, '../../data/bounties.json');

  return bountyStorePath.endsWith('.json')
    ? bountyStorePath.replace(/\.json$/i, '.webhook-deliveries.json')
    : `${bountyStorePath}.webhook-deliveries.json`;
}

function isDeliveryEntry(value: unknown): value is DeliveryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.status === 'in_progress' ||
      entry.status === 'pending' ||
      entry.status === 'completed') &&
    typeof entry.attempts === 'number' &&
    Number.isFinite(entry.attempts) &&
    typeof entry.firstSeenAt === 'number' &&
    Number.isFinite(entry.firstSeenAt) &&
    typeof entry.updatedAt === 'number' &&
    Number.isFinite(entry.updatedAt)
  );
}

/**
 * Reads the journal from disk.
 *
 * Returns an empty object when the file does not exist, is empty, or cannot be
 * parsed. Corruption is logged at `warn` and never thrown, so a damaged journal
 * cannot take the webhook endpoint down.
 */
function readJournalFile(): Record<string, DeliveryEntry> {
  const filePath = getDeliveryJournalPath();
  try {
    if (!fs.existsSync(filePath)) return {};

    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Partial<JournalFile>;
    const deliveries = parsed?.deliveries;
    if (!deliveries || typeof deliveries !== 'object' || Array.isArray(deliveries)) {
      logger.warn(
        { filePath },
        'webhook_delivery_journal_invalid_shape; starting with an empty journal'
      );
      return {};
    }

    const valid: Record<string, DeliveryEntry> = {};
    for (const [deliveryId, entry] of Object.entries(deliveries)) {
      if (isDeliveryEntry(entry)) {
        valid[deliveryId] = {
          status: entry.status,
          attempts: Math.max(1, Math.floor(entry.attempts)),
          firstSeenAt: entry.firstSeenAt,
          updatedAt: entry.updatedAt,
          ...(entry.lastPrUrl ? { lastPrUrl: entry.lastPrUrl } : {}),
          ...(entry.lastReason ? { lastReason: entry.lastReason } : {}),
        };
      }
    }
    return valid;
  } catch (error) {
    logger.warn(
      { filePath, error: error instanceof Error ? error.message : String(error) },
      'webhook_delivery_journal_read_failed; starting with an empty journal'
    );
    return {};
  }
}

/**
 * In-process view of the journal.
 *
 * Pruning happens against this map; the map is refreshed from disk before every
 * operation so multiple processes observe each other's claims.
 */
const store = new Map<string, DeliveryEntry>();

/**
 * Merges the on-disk journal into the in-memory view.
 *
 * Newer records (by `updatedAt`) win. The in-memory view is authoritative for
 * records this process wrote but has not yet flushed (write failures are
 * best-effort), which keeps duplicate suppression working even if the volume is
 * temporarily read-only.
 */
function loadJournal(): void {
  const onDisk = readJournalFile();
  for (const [deliveryId, entry] of Object.entries(onDisk)) {
    const inMemory = store.get(deliveryId);
    if (!inMemory || entry.updatedAt >= inMemory.updatedAt) {
      store.set(deliveryId, entry);
    }
  }
}

/**
 * Removes records that can no longer be useful.
 *
 * - `completed` records older than `WEBHOOK_DEDUP_TTL_MS` no longer suppress
 *   duplicates (GitHub never redelivers that late).
 * - Unfinished records older than `WEBHOOK_DELIVERY_CLAIM_STALE_MS` are pruned
 *   with a warning: they are no longer resumable and would otherwise grow
 *   forever.
 */
function pruneExpired(now: number): void {
  for (const [deliveryId, entry] of store) {
    if (entry.status === 'completed') {
      if (now - entry.updatedAt >= DEDUP_TTL_MS) {
        store.delete(deliveryId);
      }
      continue;
    }

    if (now - entry.updatedAt >= CLAIM_STALE_MS) {
      logger.warn(
        { deliveryId, status: entry.status, attempts: entry.attempts, lastPrUrl: entry.lastPrUrl },
        'webhook_delivery_journal_pruning_stale_delivery'
      );
      store.delete(deliveryId);
    }
  }
}

/**
 * Writes the in-memory journal to disk.
 *
 * Uses a temp file plus atomic rename so an interrupted write cannot corrupt the
 * journal. Failures are logged at `warn` and swallowed: the webhook endpoint
 * stays available, and the in-memory view still suppresses duplicates for this
 * process.
 */
function persistJournal(): void {
  const now = Date.now();
  pruneExpired(now);

  const filePath = getDeliveryJournalPath();
  const deliveries: Record<string, DeliveryEntry> = {};
  for (const [deliveryId, entry] of store) {
    deliveries[deliveryId] = entry;
  }

  const payload: JournalFile = { version: JOURNAL_VERSION, deliveries };
  const tempPath = `${filePath}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(payload), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    logger.warn(
      { filePath, error: error instanceof Error ? error.message : String(error) },
      'webhook_delivery_journal_write_failed; delivery state kept in memory only'
    );
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Claims a delivery for processing.
 *
 * Call this **before** applying side effects. The claim is persisted, so a
 * process that dies mid-flight leaves an `in_progress` record behind and the
 * next attempt (GitHub redelivery, operator replay, or startup resume) is
 * treated as `resume` instead of being silently skipped.
 *
 * @param deliveryId - The `X-GitHub-Delivery` ID.
 * @param meta - Optional metadata (PR URL) stored with the claim for resumption.
 * @returns `{ decision: 'duplicate' }` when the delivery completed within the
 *   TTL window (caller must not run side effects), `'resume'` when an earlier
 *   attempt exists but never completed, and `'new'` otherwise.
 */
export function beginDelivery(deliveryId: string, meta: DeliveryMeta = {}): DeliveryClaim {
  const now = Date.now();
  loadJournal();

  const existing = store.get(deliveryId);

  if (existing && existing.status === 'completed' && now - existing.updatedAt < DEDUP_TTL_MS) {
    return {
      decision: 'duplicate',
      deliveryId,
      attempts: existing.attempts,
      firstSeenAt: existing.firstSeenAt,
    };
  }

  const attempts = (existing?.attempts ?? 0) + 1;
  const decision: DeliveryDecision =
    existing && (existing.status === 'in_progress' || existing.status === 'pending')
      ? 'resume'
      : 'new';

  store.set(deliveryId, {
    status: 'in_progress',
    attempts,
    firstSeenAt: existing?.firstSeenAt ?? now,
    updatedAt: now,
    ...(meta.prUrl
      ? { lastPrUrl: meta.prUrl }
      : existing?.lastPrUrl
        ? { lastPrUrl: existing.lastPrUrl }
        : {}),
  });
  persistJournal();

  return {
    decision,
    deliveryId,
    attempts,
    firstSeenAt: existing?.firstSeenAt ?? now,
  };
}

/**
 * Checks whether a delivery ID has already been completed within the TTL window.
 *
 * **Synchronous, disk-backed.** Never throws.
 *
 * @param deliveryId - The GitHub delivery ID from the `X-GitHub-Delivery` header.
 * @returns `true` if this delivery completed recently, `false` for unknown,
 *   unfinished, or expired deliveries (those must still be processed).
 */
export function hasBeenProcessed(deliveryId: string): boolean {
  if (!deliveryId) return false;

  const now = Date.now();
  loadJournal();

  const entry = store.get(deliveryId);
  if (!entry) return false;
  if (entry.status !== 'completed') return false;
  if (now - entry.updatedAt >= DEDUP_TTL_MS) {
    store.delete(deliveryId);
    persistJournal();
    return false;
  }

  return true;
}

/**
 * Records a delivery as successfully processed.
 *
 * Call this only after **all** side effects for the delivery have been
 * committed. The record is persisted so duplicate suppression survives a
 * restart.
 *
 * @param deliveryId - The GitHub delivery ID.
 * @param meta - Optional metadata (PR URL) to keep with the completed record.
 */
export function markAsProcessed(deliveryId: string, meta: DeliveryMeta = {}): void {
  if (!deliveryId) return;

  const now = Date.now();
  loadJournal();

  const existing = store.get(deliveryId);
  store.set(deliveryId, {
    status: 'completed',
    attempts: existing?.attempts ?? 1,
    firstSeenAt: existing?.firstSeenAt ?? now,
    updatedAt: now,
    ...(meta.prUrl
      ? { lastPrUrl: meta.prUrl }
      : existing?.lastPrUrl
        ? { lastPrUrl: existing.lastPrUrl }
        : {}),
  });
  persistJournal();
}

/**
 * Marks a delivery as still pending so it can be retried later.
 *
 * Use this when processing could not complete but nothing is broken — e.g. the
 * merged-PR event arrived before the bounty submission was recorded
 * (out-of-order delivery), or a transient store error occurred. The delivery
 * stays resumable and `handleGitHubPrEvent` will re-drive it on redelivery or
 * at startup, instead of acknowledging it as done and losing the effect.
 *
 * @param deliveryId - The GitHub delivery ID.
 * @param meta - Optional PR URL / reason for operator visibility.
 */
export function deferDelivery(deliveryId: string, meta: DeliveryMeta = {}): void {
  if (!deliveryId) return;

  const now = Date.now();
  loadJournal();

  const existing = store.get(deliveryId);
  store.set(deliveryId, {
    status: 'pending',
    attempts: existing?.attempts ?? 1,
    firstSeenAt: existing?.firstSeenAt ?? now,
    updatedAt: now,
    ...(meta.prUrl
      ? { lastPrUrl: meta.prUrl }
      : existing?.lastPrUrl
        ? { lastPrUrl: existing.lastPrUrl }
        : {}),
    ...(meta.reason ? { lastReason: meta.reason } : {}),
  });
  persistJournal();
}

/**
 * Forgets a delivery entirely, allowing the next delivery with the same ID to
 * be processed as new.
 *
 * Intended for tests and operator tooling; production code should prefer
 * {@link deferDelivery} or {@link markAsProcessed}.
 *
 * @param deliveryId - The GitHub delivery ID.
 */
export function forgetDelivery(deliveryId: string): void {
  if (!deliveryId) return;
  loadJournal();
  if (store.delete(deliveryId)) {
    persistJournal();
  }
}

/**
 * Lists deliveries that are still waiting to be processed.
 *
 * Called at startup by {@link resumePendingDeliveries} so a merged-PR event that
 * arrived while the process was down (or before its bounty was submitted) is
 * applied without waiting for a manual GitHub redelivery.
 *
 * @returns Unfinished deliveries ordered by when they were first seen.
 */
export function getPendingDeliveries(): PendingDelivery[] {
  loadJournal();
  pruneExpired(Date.now());

  return [...store.entries()]
    .filter(([, entry]) => entry.status !== 'completed')
    .map(([deliveryId, entry]) => ({
      deliveryId,
      status: entry.status as Exclude<DeliveryStatus, 'completed'>,
      attempts: entry.attempts,
      ...(entry.lastPrUrl ? { prUrl: entry.lastPrUrl } : {}),
      ...(entry.lastReason ? { reason: entry.lastReason } : {}),
      firstSeenAt: entry.firstSeenAt,
    }))
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt);
}

/**
 * Clears the entire journal, both in memory and on disk.
 *
 * **This is intended for testing only.** Calling it in production will lose
 * duplicate-suppression and resumption state for every in-flight delivery.
 *
 * @internal
 */
export function __resetDeliveryDedupStoreForTests(): void {
  store.clear();

  const filePath = getDeliveryJournalPath();
  for (const candidate of [filePath, `${filePath}.${process.pid}.tmp`]) {
    try {
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
    } catch {
      /* best effort */
    }
  }
}

// Periodically drop expired records so an idle process does not keep them
// forever. Unref'd so tests and one-off scripts can exit.
const cleanupTimer = setInterval(() => {
  loadJournal();
  pruneExpired(Date.now());
  persistJournal();
}, CLEANUP_INTERVAL_MS);

cleanupTimer.unref();
