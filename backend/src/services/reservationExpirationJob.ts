import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';
import type { BountyRecord } from './bountyStore';

export interface ExpirationResult {
  expiredCount: number;
  expiredBountyIds: string[];
  checkedAt: number;
}

function getReservationTtlSeconds(): number {
  const days = Number(process.env.RESERVATION_TTL_DAYS ?? '7');

  if (!Number.isFinite(days) || days <= 0) {
    logger.warn(
      { RESERVATION_TTL_DAYS: process.env.RESERVATION_TTL_DAYS },
      '[ExpirationJob] Invalid RESERVATION_TTL_DAYS — falling back to 7 days'
    );

    return 7 * 24 * 60 * 60;
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

function expireReservation(
  bounty: BountyRecord,
  checkedAt: number,
  ttlSeconds: number
): BountyRecord {
  return {
    ...bounty,
    status: 'open',
    contributor: undefined,
    reservedAt: undefined,
    version: (bounty.version ?? 1) + 1,
    events: [
      ...(bounty.events ?? []),
      {
        type: 'expired',
        timestamp: checkedAt,
        details: {
          reason: 'reservation_ttl_exceeded',
          ttlSeconds,
        },
      },
    ],
  };
}

export function expireStaleReservations(ttlSeconds?: number): ExpirationResult {
  const checkedAt = Math.floor(Date.now() / 1000);
  const ttl = ttlSeconds ?? getReservationTtlSeconds();
  const bounties = readBounties();

  const expiredBountyIds: string[] = [];

  const updated = bounties.map((bounty) => {
    const isStaleReservation =
      bounty.status === 'reserved' &&
      typeof bounty.reservedAt === 'number' &&
      checkedAt - bounty.reservedAt > ttl;

    if (!isStaleReservation) {
      return bounty;
    }

    logger.info(
      {
        bountyId: bounty.id,
        contributor: bounty.contributor,
      },
      '[ExpirationJob] Expiring stale reservation'
    );

    expiredBountyIds.push(bounty.id);

    return expireReservation(bounty, checkedAt, ttl);
  });

  writeBounties(updated);

  return {
    expiredCount: expiredBountyIds.length,
    expiredBountyIds,
    checkedAt,
  };
}

let expirationTimer: ReturnType<typeof setInterval> | null = null;

export function startExpirationJob(intervalMs = 3_600_000, ttlSeconds?: number): void {
  if (expirationTimer) {
    logger.warn('[ExpirationJob] Already running — ignoring duplicate start');
    return;
  }

  expireStaleReservations(ttlSeconds);

  expirationTimer = setInterval(() => {
    expireStaleReservations(ttlSeconds);
  }, intervalMs);
}

export function stopExpirationJob(): void {
  if (!expirationTimer) {
    return;
  }

  clearInterval(expirationTimer);
  expirationTimer = null;
}
