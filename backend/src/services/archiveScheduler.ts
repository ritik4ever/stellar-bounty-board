import fs from 'node:fs';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { logger } from '../logger';
import type { BountyRecord } from './bountyStore';
import { invalidateBountyCache } from './bountyStore';
import { getBountyArchivePath } from './bountyArchivePath';
import { wrapServiceError } from './errors';

/**
 * Statuses that are eligible for automatic archiving once the retention
 * window has elapsed.
 */
const ARCHIVABLE_STATUSES = new Set<BountyRecord['status']>(['released', 'refunded']);

export interface ArchiveResult {
  archivedCount: number;
  archivedBountyIds: string[];
  checkedAt: number;
}

/**
 * Returns the retention period in seconds after which a released/refunded
 * bounty should be auto-archived.
 *
 * Reads ARCHIVE_AFTER_DAYS from the environment (default: 90 days).
 */
function getRetentionSeconds(): number {
  const days = Number(process.env.ARCHIVE_AFTER_DAYS ?? '90');

  if (!Number.isFinite(days) || days <= 0) {
    logger.warn(
      { ARCHIVE_AFTER_DAYS: process.env.ARCHIVE_AFTER_DAYS },
      '[ArchiveScheduler] Invalid ARCHIVE_AFTER_DAYS — falling back to 90 days'
    );
    return 90 * 24 * 60 * 60;
  }

  return Math.floor(days * 24 * 60 * 60);
}

function getStorePath(): string {
  if (process.env.BOUNTY_STORE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_STORE_PATH.trim());
  }
  return path.resolve(__dirname, '../../data/bounties.json');
}

function readBounties(storePath: string): BountyRecord[] {
  try {
    if (!fs.existsSync(storePath)) {
      return [];
    }

    const raw = fs.readFileSync(storePath, 'utf8').trim();

    if (!raw) {
      return [];
    }

    const records = JSON.parse(raw) as BountyRecord[];
    if (!Array.isArray(records)) throw new Error('Bounty store must contain an array');
    return records;
  } catch (err) {
    throw wrapServiceError('archive_scheduler.read_store', 'json-store', err);
  }
}

function writeBounties(storePath: string, records: BountyRecord[]): void {
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const tmpPath = `${storePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2));
      fs.renameSync(tmpPath, storePath);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  } catch (err) {
    throw wrapServiceError('archive_scheduler.write_store', 'json-store', err);
  }
}

/**
 * Derives the "terminal timestamp" for a bounty — i.e. the time at which it
 * reached its final released/refunded state.  Falls back to `createdAt` if
 * the specific timestamp is somehow absent.
 */
function terminalTimestamp(bounty: BountyRecord): number {
  if (bounty.status === 'released' && typeof bounty.releasedAt === 'number') {
    return bounty.releasedAt;
  }
  if (bounty.status === 'refunded' && typeof bounty.refundedAt === 'number') {
    return bounty.refundedAt;
  }
  return bounty.createdAt;
}

/**
 * Scans all bounties and archives any that are in a terminal state
 * (released/refunded) and whose terminal timestamp is older than
 * `retentionSeconds`.
 *
 * Writes the cold archive before removing records from the active file. A retry
 * deduplicates by ID if the process stops between those two writes.
 *
 * @param retentionSeconds - Override the env-configured retention window (used in tests).
 */
export async function archiveOldBounties(retentionSeconds?: number): Promise<ArchiveResult> {
  const checkedAt = Math.floor(Date.now() / 1000);
  const retention = retentionSeconds ?? getRetentionSeconds();
  const storePath = getStorePath();
  const archivedBountyIds: string[] = [];
  if (!fs.existsSync(storePath)) return { archivedCount: 0, archivedBountyIds, checkedAt };
  const release = await lockfile.lock(storePath, { stale: 10000, update: 5000, retries: 0 });
  try {
    const bounties = readBounties(storePath);
    const retained: BountyRecord[] = [];
    const moving: BountyRecord[] = [];
    for (const bounty of bounties) {
      if (
        !ARCHIVABLE_STATUSES.has(bounty.status) ||
        (!bounty.archived && checkedAt - terminalTimestamp(bounty) <= retention)
      ) {
        retained.push(bounty);
        continue;
      }
      archivedBountyIds.push(bounty.id);
      moving.push(
        bounty.archived
          ? bounty
          : {
              ...bounty,
              archived: true,
              archivedAt: checkedAt,
              version: (bounty.version ?? 1) + 1,
              events: [
                ...(bounty.events ?? []),
                {
                  type: 'archived',
                  timestamp: checkedAt,
                  details: { reason: 'retention_window_exceeded', retentionSeconds: retention },
                },
              ],
            }
      );
    }
    if (moving.length > 0) {
      const archivePath = getBountyArchivePath(storePath);
      const archive = readBounties(archivePath);
      const archivedIds = new Set(archive.map((bounty) => bounty.id));
      writeBounties(archivePath, [
        ...archive,
        ...moving.filter((bounty) => !archivedIds.has(bounty.id)),
      ]);
      writeBounties(storePath, retained);
      await invalidateBountyCache();
    }
  } finally {
    await release();
  }

  logger.info(
    {
      archivedCount: archivedBountyIds.length,
      checkedAt,
    },
    '[ArchiveScheduler] Archive run complete'
  );

  return {
    archivedCount: archivedBountyIds.length,
    archivedBountyIds,
    checkedAt,
  };
}

let archiveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the recurring archive background job.
 *
 * Runs once immediately on startup then on every `intervalMs` thereafter.
 * Default interval is 24 hours; override via ARCHIVE_JOB_INTERVAL_MS.
 *
 * @param intervalMs - Override the env-configured polling interval (used in tests).
 * @param retentionSeconds - Override the env-configured retention window (used in tests).
 */
export function startArchiveJob(intervalMs?: number, retentionSeconds?: number): void {
  if (archiveTimer) {
    logger.warn('[ArchiveScheduler] Already running — ignoring duplicate start');
    return;
  }

  const resolvedInterval =
    intervalMs ??
    (() => {
      const envMs = Number(process.env.ARCHIVE_JOB_INTERVAL_MS ?? '86400000');
      return Number.isFinite(envMs) && envMs > 0 ? envMs : 86_400_000;
    })();

  // Run immediately on startup, then on interval
  void archiveOldBounties(retentionSeconds).catch((err) =>
    logger.error({ err }, '[ArchiveScheduler] Archive run failed')
  );

  archiveTimer = setInterval(() => {
    void archiveOldBounties(retentionSeconds).catch((err) =>
      logger.error({ err }, '[ArchiveScheduler] Archive run failed')
    );
  }, resolvedInterval);
}

export function stopArchiveJob(): void {
  if (!archiveTimer) {
    return;
  }

  clearInterval(archiveTimer);
  archiveTimer = null;
}
