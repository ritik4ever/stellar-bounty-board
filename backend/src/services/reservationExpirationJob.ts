/**
 * reservationExpirationJob.ts
 *
 * Cron job that runs on a configurable interval and expires stale bounty
 * reservations — returning them to "open" so other contributors can claim them.
 *
 * Configuration (via environment variables):
 *   RESERVATION_TTL_DAYS       — how many days before a reservation expires (default: 7)
 *   EXPIRATION_CRON_INTERVAL_MS — polling interval in milliseconds (default: 3_600_000 = 1 hour)
 */

import { listBounties, type BountyRecord } from "./bountyStore";
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../logger";

// ── Configuration ─────────────────────────────────────────────────────────────

function getReservationTtlSeconds(): number {
  const days = Number(process.env.RESERVATION_TTL_DAYS ?? "7");
  if (!Number.isFinite(days) || days <= 0) {
    logger.warn(
      { RESERVATION_TTL_DAYS: process.env.RESERVATION_TTL_DAYS },
      "[ExpirationJob] Invalid RESERVATION_TTL_DAYS — falling back to 7 days",
    );
    return 7 * 24 * 60 * 60;
  }
  return Math.floor(days * 24 * 60 * 60);
}

function getCronIntervalMs(): number {
  const ms = Number(process.env.EXPIRATION_CRON_INTERVAL_MS ?? "3600000");
  if (!Number.isFinite(ms) || ms <= 0) {
    logger.warn(
      { EXPIRATION_CRON_INTERVAL_MS: process.env.EXPIRATION_CRON_INTERVAL_MS },
      "[ExpirationJob] Invalid EXPIRATION_CRON_INTERVAL_MS — falling back to 1 hour",
    );
    return 60 * 60 * 1000;
  }
  return Math.floor(ms);
}

function getStorePath(): string {
  if (process.env.BOUNTY_STORE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_STORE_PATH.trim());
  }
  return path.resolve(__dirname, "../../data/bounties.json");
}

// ── Core expiration logic ─────────────────────────────────────────────────────

export interface ExpirationResult {
  expiredCount: number;
  expiredBountyIds: string[];
  checkedAt: number;
}

/**
 * Scan all reserved bounties and expire those whose reservation has been
 * held longer than `ttlSeconds` without a submission.
 *
 * Returns a summary of what was expired.
 */
export function expireStaleReservations(ttlSeconds?: number): ExpirationResult {
  const effectiveTtl = ttlSeconds ?? getReservationTtlSeconds();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const checkedAt = nowSeconds;

  const bounties = listBounties();
  const malformed = bounties.filter(
    (b) =>
      b.status === "reserved" &&
      (typeof b.reservedAt !== "number" || !Number.isFinite(b.reservedAt)),
  );

  for (const bounty of malformed) {
    logger.warn(
      {
        bountyId: bounty.id,
        reservedAt: bounty.reservedAt,
      },
      "[ExpirationJob] Skipping reserved bounty with malformed reservedAt",
    );
  }

  const stale = bounties.filter(
    (b): b is BountyRecord & { reservedAt: number; contributor: string } =>
      b.status === "reserved" &&
      typeof b.reservedAt === "number" &&
      Number.isFinite(b.reservedAt) &&
      nowSeconds - b.reservedAt > effectiveTtl,
  );

  if (stale.length === 0) {
    logger.info(
      { ttlDays: effectiveTtl / 86400, checkedCount: bounties.length },
      "[ExpirationJob] No stale reservations found",
    );
    return { expiredCount: 0, expiredBountyIds: [], checkedAt };
  }

  // Read the raw store file and patch it directly to avoid circular imports
  const storePath = getStorePath();
  const raw: BountyRecord[] = JSON.parse(fs.readFileSync(storePath, "utf8"));

  const staleIds = new Set(stale.map((b) => b.id));
  const updated = raw.map((record) => {
    if (!staleIds.has(record.id)) return record;

    logger.info(
      {
        bountyId: record.id,
        contributor: record.contributor,
        reservedAt: record.reservedAt,
        ttlDays: effectiveTtl / 86400,
        staleSinceSeconds: nowSeconds - (record.reservedAt ?? 0),
      },
      "[ExpirationJob] Expiring stale reservation",
    );

    return {
      ...record,
      status: "open" as const,
      contributor: undefined,
      reservedAt: undefined,
      version: (record.version ?? 1) + 1,
      events: [
        ...(record.events ?? []),
        {
          type: "expired" as const,
          timestamp: nowSeconds,
          details: {
            reason: "reservation_ttl_exceeded",
            ttlSeconds: effectiveTtl,
          },
        },
      ],
    };
  });

  fs.writeFileSync(storePath, JSON.stringify(updated, null, 2));

  const expiredBountyIds = stale.map((b) => b.id);
  logger.info(
    { expiredCount: expiredBountyIds.length, expiredBountyIds },
    "[ExpirationJob] Stale reservations expired",
  );

  return { expiredCount: expiredBountyIds.length, expiredBountyIds, checkedAt };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the auto-expiration cron job.
 *
 * @param intervalMs  Override the polling interval (useful in tests).
 * @param ttlSeconds  Override the reservation TTL (useful in tests).
 */
export function startExpirationJob(intervalMs?: number, ttlSeconds?: number): void {
  if (_timer) {
    logger.warn("[ExpirationJob] Already running — ignoring duplicate start");
    return;
  }

  const effectiveInterval = intervalMs ?? getCronIntervalMs();
  const effectiveTtl = ttlSeconds ?? getReservationTtlSeconds();

  logger.info(
    {
      intervalMs: effectiveInterval,
      ttlDays: effectiveTtl / 86400,
    },
    "[ExpirationJob] Starting bounty auto-expiration cron",
  );

  // Run immediately on start then on every interval
  expireStaleReservations(effectiveTtl);

  _timer = setInterval(() => {
    try {
      expireStaleReservations(effectiveTtl);
    } catch (err) {
      logger.error({ err }, "[ExpirationJob] Unexpected error during expiration run");
    }
  }, effectiveInterval);
}

/**
 * Stop the cron job (useful in tests and graceful shutdown).
 */
export function stopExpirationJob(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info("[ExpirationJob] Cron stopped");
  }
}
