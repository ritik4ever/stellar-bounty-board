import fs from "node:fs";
import path from "node:path";
import { logStructured } from "../logger";
import { sendNotification } from "./notificationService";
import type { BountyRecord } from "./bountyStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DisputeAlertResult {
  /** Number of bounties that triggered an alert this cycle. */
  alertedCount: number;
  /** IDs of bounties for which alerts were sent. */
  alertedBountyIds: string[];
  /** Unix timestamp in seconds when the scan completed. */
  checkedAt: number;
}

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Maximum number of hours a bounty may remain in the "disputed" state before
 * an admin alert is triggered.
 *
 * Controlled by the `DISPUTE_SLA_HOURS` environment variable (default: 72).
 */
function getDisputeSlaHours(): number {
  const raw = process.env.DISPUTE_SLA_HOURS?.trim();
  if (!raw) return 72;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logStructured("warn", "dispute_alert_config_invalid", {
      DISPUTE_SLA_HOURS: raw,
      reason: "must be a positive number — falling back to 72",
    });
    return 72;
  }

  return parsed;
}

/**
 * Minimum interval (in hours) between consecutive admin alerts for the same
 * stuck bounty.
 *
 * Controlled by the `DISPUTE_ALERT_INTERVAL_HOURS` environment variable
 * (default: 24).
 */
function getDisputeAlertIntervalHours(): number {
  const raw = process.env.DISPUTE_ALERT_INTERVAL_HOURS?.trim();
  if (!raw) return 24;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logStructured("warn", "dispute_alert_config_invalid", {
      DISPUTE_ALERT_INTERVAL_HOURS: raw,
      reason: "must be a positive number — falling back to 24",
    });
    return 24;
  }

  return parsed;
}

/**
 * Email address(es) to receive dispute stuck alerts.
 *
 * Controlled by `ADMIN_ALERT_EMAIL` (comma-separated). When empty the job
 * still updates `lastDisputeAlertAt` but skips notification dispatch.
 */
function getAdminAlertEmails(): string[] {
  const raw = process.env.ADMIN_ALERT_EMAIL?.trim();
  if (!raw) return [];

  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Store helpers ────────────────────────────────────────────────────────────

function getStorePath(): string {
  if (process.env.BOUNTY_STORE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_STORE_PATH.trim());
  }
  return path.resolve(__dirname, "../../data/bounties.json");
}

function readBounties(): BountyRecord[] {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) return [];

  const raw = fs.readFileSync(storePath, "utf8").trim();
  if (!raw) return [];

  return JSON.parse(raw) as BountyRecord[];
}

function writeBounties(records: BountyRecord[]): void {
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(records, null, 2));
}

// ─── Core logic ───────────────────────────────────────────────────────────────

/**
 * Scan all bounties for those stuck in the "disputed" state beyond the
 * configured SLA threshold and send a single admin alert per bounty per
 * alert interval.
 *
 * Returns metadata about what was done so callers can log it.
 */
export function scanAndAlertStuckDisputes(): DisputeAlertResult {
  const checkedAt = Math.floor(Date.now() / 1000);
  const slaHours = getDisputeSlaHours();
  const alertIntervalHours = getDisputeAlertIntervalHours();
  const slaSeconds = slaHours * 3600;
  const alertIntervalSeconds = alertIntervalHours * 3600;

  const bounties = readBounties();
  const alertedBountyIds: string[] = [];
  const adminEmails = getAdminAlertEmails();

  const updated = bounties.map((bounty) => {
    // Only consider bounties currently in "disputed" status
    if (bounty.status !== "disputed") return bounty;
    if (typeof bounty.disputedAt !== "number" || bounty.disputedAt <= 0)
      return bounty;

    const hoursDisputed =
      Math.round(((checkedAt - bounty.disputedAt) / 3600) * 100) / 100;

    // Not past the SLA threshold yet — nothing to do
    if (checkedAt - bounty.disputedAt < slaSeconds) return bounty;

    // Already alerted within the interval window — skip duplicate
    if (
      typeof bounty.lastDisputeAlertAt === "number" &&
      checkedAt - bounty.lastDisputeAlertAt < alertIntervalSeconds
    ) {
      return bounty;
    }

    // ── Stuck dispute detected ──────────────────────────────────────────
    logStructured("warn", "dispute_stuck_scan", {
      bountyId: bounty.id,
      disputedAt: bounty.disputedAt,
      hoursDisputed,
      lastDisputeAlertAt: bounty.lastDisputeAlertAt ?? null,
    });

    alertedBountyIds.push(bounty.id);

    // Fire-and-forget notification to admin recipients
    if (adminEmails.length > 0) {
      const recipients = adminEmails.map((email) => ({
        role: "admin" as const,
        address: email,
      }));

      sendNotification(recipients, "dispute_stuck_alert", {
        bountyId: bounty.id,
        title: bounty.title,
        repo: bounty.repo,
        contributor: bounty.contributor ?? "N/A",
        maintainer: bounty.maintainer,
        amount: bounty.amount,
        tokenSymbol: bounty.tokenSymbol,
        disputedAt: bounty.disputedAt,
        hoursDisputed,
        disputeReason: bounty.disputeReason ?? "N/A",
        lastDisputeAlertAt: bounty.lastDisputeAlertAt ?? null,
      }).catch((err) =>
        logStructured("error", "dispute_alert_dispatch_failed", {
          bountyId: bounty.id,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // Record that we sent an alert so we don't spam
    return { ...bounty, lastDisputeAlertAt: checkedAt };
  });

  writeBounties(updated);

  return {
    alertedCount: alertedBountyIds.length,
    alertedBountyIds,
    checkedAt,
  };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let disputeAlertTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic dispute-alert scanner.
 *
 * @param intervalMs  How often to scan (default: every hour = 3 600 000 ms).
 */
export function startDisputeAlertJob(intervalMs = 3_600_000): void {
  if (disputeAlertTimer) {
    logStructured("warn", "dispute_alert_already_running", {});
    return;
  }

  // Run immediately on startup so stuck bounties aren't missed.
  scanAndAlertStuckDisputes();

  disputeAlertTimer = setInterval(() => {
    scanAndAlertStuckDisputes();
  }, intervalMs);
}

/**
 * Stop the periodic dispute-alert scanner. Safe to call multiple times.
 */
export function stopDisputeAlertJob(): void {
  if (!disputeAlertTimer) return;

  clearInterval(disputeAlertTimer);
  disputeAlertTimer = null;
}
