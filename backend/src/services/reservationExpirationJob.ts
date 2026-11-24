import { logger } from '../logger';
import { expireStaleReservations as expireReservationsInStore } from './bountyStore';
import { getServicesConfig } from './config';

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

/**
 * Expire reservations older than the configured TTL.
 *
 * The read-modify-write happens inside the store's file lock
 * ({@link expireReservationsInStore}), so a run that overlaps a reserve or
 * refund commits at most once and never clobbers the newer record.
 *
 * @param ttlSeconds - Optional TTL override; defaults to `RESERVATION_TTL_DAYS`.
 * @returns How many reservations were released, which ones, and when.
 */
export async function expireStaleReservations(ttlSeconds?: number): Promise<ExpirationResult> {
  const ttl = ttlSeconds ?? getReservationTtlSeconds();
  const { expiredBountyIds, checkedAt } = await expireReservationsInStore(ttl);

  return {
    expiredCount: expiredBountyIds.length,
    expiredBountyIds,
    checkedAt,
  };
}

let expirationTimer: ReturnType<typeof setInterval> | null = null;

export async function startExpirationJob(
  intervalMs = getServicesConfig().expirationJobIntervalMs,
  ttlSeconds?: number
): Promise<void> {
  if (expirationTimer) {
    logger.warn('[ExpirationJob] Already running — ignoring duplicate start');
    return;
  }

  await expireStaleReservations(ttlSeconds).catch((err) => {
    logger.error({ err }, '[ExpirationJob] Initial expiration run failed');
  });

  expirationTimer = setInterval(() => {
    expireStaleReservations(ttlSeconds).catch((err) => {
      logger.error({ err }, '[ExpirationJob] Scheduled expiration run failed');
    });
  }, intervalMs);
}

export function stopExpirationJob(): void {
  if (!expirationTimer) {
    return;
  }

  clearInterval(expirationTimer);
  expirationTimer = null;
}
