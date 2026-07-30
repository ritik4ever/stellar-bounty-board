import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';
import type { BountyRecord } from './bountyStore';

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
      '[ArchiveScheduler] Invalid ARCHIVE_AFTER_DAYS — falling back to 90 days',
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

function readBounties(): BountyRecord[] {
  const storePath = getStorePath();

  if (!fs.existsSync(storePath)) {
    return [];
  }

  const raw = fs.readFileSync(storePath, 'utf8').trim();

  if (!raw) {
    return [];
  }

  return JSON.parse(raw) as BountyRecord[];
}

function writeBounties(records: BountyRecord[]): void {
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(records, null, 2));
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
 * Already-archived bounties are skipped.
 *
 * @param retentionSeconds - Override the env-configured retention window (used in tests).
 */
export function archiveOldBounties(retentionSeconds?: number): ArchiveResult {
  const checkedAt = Math.floor(Date.now() / 1000);
  const retention = retentionSeconds ?? getRetentionSeconds();
  const bounties = readBounties();

  const archivedBountyIds: string[] = [];

  const updated = bounties.map((bounty) => {
    // Skip already-archived bounties and ineligible statuses
    if (bounty.archived || !ARCHIVABLE_STATUSES.has(bounty.status)) {
      return bounty;
    }

    const elapsed = checkedAt - terminalTimestamp(bounty);

    if (elapsed <= retention) {
      return bounty;
    }

    logger.info(
      {
        bountyId: bounty.id,
        status: bounty.status,
        elapsedDays: Math.floor(elapsed / 86400),
        retentionDays: Math.floor(retention / 86400),
      },
      '[ArchiveScheduler] Archiving bounty past retention window',
    );

    archivedBountyIds.push(bounty.id);

    return {
      ...bounty,
      archived: true,
      archivedAt: checkedAt,
      version: (bounty.version ?? 1) + 1,
      events: [
        ...(bounty.events ?? []),
        {
          type: 'archived' as const,
          timestamp: checkedAt,
          details: {
            reason: 'retention_window_exceeded',
            retentionSeconds: retention,
          },
        },
      ],
    };
  });

  if (archivedBountyIds.length > 0) {
    writeBounties(updated);
  }

  logger.info(
    {
      archivedCount: archivedBountyIds.length,
      checkedAt,
    },
    '[ArchiveScheduler] Archive run complete',
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
  archiveOldBounties(retentionSeconds);

  archiveTimer = setInterval(() => {
    archiveOldBounties(retentionSeconds);
  }, resolvedInterval);
}

export function stopArchiveJob(): void {
  if (!archiveTimer) {
    return;
  }

  clearInterval(archiveTimer);
  archiveTimer = null;
}
