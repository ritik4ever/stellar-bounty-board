import fs from "node:fs";
import path from "node:path";
import { logStructured } from "../logger";
import { sendNotification, type NotificationRecipient } from "./notificationService";
import { listBounties, type BountyRecord } from "./bountyStore";

/**
 * Metadata definition for a badge/achievement.
 */
export interface BadgeDefinition {
  /** Unique badge identifier */
  id: string;
  /** Display name of the badge */
  name: string;
  /** Description of what this badge represents */
  description: string;
  /** Category of the badge */
  category: "completion" | "milestone" | "ranking" | "special";
  /** Icon/emoji for the badge */
  icon: string;
}

/**
 * Standard badge criteria definitions.
 */
export const BADGE_DEFINITIONS: Record<string, BadgeDefinition> = {
  "first-bounty-completed": {
    id: "first-bounty-completed",
    name: "First Bounty Completed",
    description: "Awarded upon successfully completing and receiving payout for your first bounty.",
    category: "completion",
    icon: "🎯",
  },
  "ten-bounties-completed": {
    id: "ten-bounties-completed",
    name: "10 Bounties Completed",
    description: "Awarded upon reaching the milestone of 10 successfully completed bounties.",
    category: "milestone",
    icon: "🏆",
  },
  "top-earner-of-month": {
    id: "top-earner-of-month",
    name: "Top Earner of the Month",
    description: "Awarded to the contributor with the highest earnings across all released bounties in a calendar month.",
    category: "ranking",
    icon: "⭐",
  },
};

/**
 * A badge earned by a contributor.
 */
export interface BadgeRecord {
  /** Unique ID of the badge award instance */
  id: string;
  /** Badge criteria ID (e.g. "first-bounty-completed") */
  badgeId: string;
  /** Display name of the badge */
  name: string;
  /** Badge description */
  description: string;
  /** Badge category */
  category?: string;
  /** Badge icon */
  icon?: string;
  /** Stellar address of the contributor who earned the badge */
  contributor: string;
  /** Unix timestamp in seconds when the badge was awarded */
  awardedAt: number;
  /** Additional metadata (e.g. bountyId, month, count, amount) */
  metadata?: Record<string, unknown>;
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function getBadgesStorePath(): string {
  if (process.env.BADGES_STORE_PATH?.trim()) {
    return path.resolve(process.env.BADGES_STORE_PATH.trim());
  }

  if (process.env.BOUNTY_STORE_PATH?.trim()) {
    const base = path.resolve(process.env.BOUNTY_STORE_PATH.trim());
    return base.endsWith(".json")
      ? base.replace(/\.json$/i, ".badges.json")
      : `${base}.badges.json`;
  }

  return path.resolve(__dirname, "../../data/badges.json");
}

function ensureBadgesStore(): void {
  const storePath = getBadgesStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify([], null, 2));
    return;
  }

  const raw = fs.readFileSync(storePath, "utf8").trim();
  if (!raw) {
    fs.writeFileSync(storePath, JSON.stringify([], null, 2));
  }
}

export function readBadgesStore(): BadgeRecord[] {
  ensureBadgesStore();
  const storePath = getBadgesStorePath();
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8")) as BadgeRecord[];
  } catch {
    return [];
  }
}

export function writeBadgesStore(records: BadgeRecord[]): void {
  ensureBadgesStore();
  fs.writeFileSync(getBadgesStorePath(), JSON.stringify(records, null, 2));
}

function nextBadgeId(records: BadgeRecord[]): string {
  const highest = records.reduce((max, record) => {
    const numeric = Number(record.id.replace("BDG-", ""));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
  return `BDG-${String(highest + 1).padStart(6, "0")}`;
}

/**
 * Format a unix timestamp in seconds to YYYY-MM month string.
 */
function toMonthKey(timestampInSeconds: number): string {
  const date = new Date(timestampInSeconds * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Evaluates and awards any eligible badges for a contributor.
 * Synchronous storage evaluation.
 *
 * @param contributor - Stellar address of the contributor
 * @param triggerBounty - Optional bounty that triggered this evaluation
 * @returns Array of newly awarded badges
 */
export function evaluateContributorBadgesSync(
  contributor: string,
  triggerBounty?: BountyRecord,
): BadgeRecord[] {
  const allBounties = listBounties();
  const allBadges = readBadgesStore();
  const contributorBadges = allBadges.filter((b) => b.contributor === contributor);

  // Get all released bounties for this contributor, sorted chronologically
  const releasedForContributor = allBounties
    .filter((b) => b.status === "released" && b.contributor === contributor)
    .sort((a, b) => (a.releasedAt ?? a.createdAt) - (b.releasedAt ?? b.createdAt));

  const newlyAwarded: BadgeRecord[] = [];
  const currentBadges = [...allBadges];

  // 1. First Bounty Completed
  if (releasedForContributor.length >= 1) {
    const hasFirstBadge = contributorBadges.some(
      (b) => b.badgeId === "first-bounty-completed",
    );
    if (!hasFirstBadge) {
      const firstBounty = releasedForContributor[0];
      const awardedAt = firstBounty.releasedAt ?? nowInSeconds();
      const badgeDef = BADGE_DEFINITIONS["first-bounty-completed"];
      const newBadge: BadgeRecord = {
        id: nextBadgeId(currentBadges),
        badgeId: badgeDef.id,
        name: badgeDef.name,
        description: badgeDef.description,
        category: badgeDef.category,
        icon: badgeDef.icon,
        contributor,
        awardedAt,
        metadata: {
          bountyId: firstBounty.id,
          amount: firstBounty.amount,
          tokenSymbol: firstBounty.tokenSymbol,
        },
      };
      currentBadges.push(newBadge);
      newlyAwarded.push(newBadge);
    }
  }

  // 2. 10 Bounties Completed
  if (releasedForContributor.length >= 10) {
    const hasTenBadge = contributorBadges.some(
      (b) => b.badgeId === "ten-bounties-completed",
    );
    if (!hasTenBadge) {
      const tenthBounty = releasedForContributor[9];
      const awardedAt = tenthBounty.releasedAt ?? nowInSeconds();
      const badgeDef = BADGE_DEFINITIONS["ten-bounties-completed"];
      const newBadge: BadgeRecord = {
        id: nextBadgeId(currentBadges),
        badgeId: badgeDef.id,
        name: badgeDef.name,
        description: badgeDef.description,
        category: badgeDef.category,
        icon: badgeDef.icon,
        contributor,
        awardedAt,
        metadata: {
          bountyId: tenthBounty.id,
          completedCount: releasedForContributor.length,
        },
      };
      currentBadges.push(newBadge);
      newlyAwarded.push(newBadge);
    }
  }

  // 3. Top Earner of the Month
  // Group all released bounties across the platform by calendar month
  const allReleased = allBounties.filter((b) => b.status === "released" && b.contributor);
  const monthToContributorEarnings: Record<string, Record<string, number>> = {};
  const monthToLatestTimestamp: Record<string, number> = {};

  for (const b of allReleased) {
    const ts = b.releasedAt ?? b.createdAt;
    const monthKey = toMonthKey(ts);
    if (!monthToContributorEarnings[monthKey]) {
      monthToContributorEarnings[monthKey] = {};
    }
    const c = b.contributor as string;
    monthToContributorEarnings[monthKey][c] =
      (monthToContributorEarnings[monthKey][c] ?? 0) + b.amount;
    monthToLatestTimestamp[monthKey] = Math.max(
      monthToLatestTimestamp[monthKey] ?? 0,
      ts,
    );
  }

  for (const [monthKey, contributorEarnings] of Object.entries(monthToContributorEarnings)) {
    let topEarner: string | null = null;
    let maxEarnings = 0;

    for (const [cAddress, totalEarned] of Object.entries(contributorEarnings)) {
      if (totalEarned > maxEarnings) {
        maxEarnings = totalEarned;
        topEarner = cAddress;
      }
    }

    if (topEarner === contributor && maxEarnings > 0) {
      const hasMonthBadge = currentBadges.some(
        (b) =>
          b.contributor === contributor &&
          b.badgeId === "top-earner-of-month" &&
          (b.metadata?.month === monthKey || (!b.metadata?.month && monthKey === toMonthKey(b.awardedAt))),
      );

      if (!hasMonthBadge) {
        const badgeDef = BADGE_DEFINITIONS["top-earner-of-month"];
        const awardedAt = monthToLatestTimestamp[monthKey] ?? nowInSeconds();
        const newBadge: BadgeRecord = {
          id: nextBadgeId(currentBadges),
          badgeId: badgeDef.id,
          name: badgeDef.name,
          description: `Top earner across all bounties in ${monthKey} with ${maxEarnings} XLM/tokens earned.`,
          category: badgeDef.category,
          icon: badgeDef.icon,
          contributor,
          awardedAt,
          metadata: {
            month: monthKey,
            totalEarnings: maxEarnings,
            triggerBountyId: triggerBounty?.id,
          },
        };
        currentBadges.push(newBadge);
        newlyAwarded.push(newBadge);
      }
    }
  }

  if (newlyAwarded.length > 0) {
    writeBadgesStore(currentBadges);
  }

  return newlyAwarded;
}

/**
 * Evaluates and awards badges for a contributor, and triggers notifications for any newly earned badges.
 *
 * @param contributor - Stellar address of the contributor
 * @param triggerBounty - Optional bounty that triggered this evaluation
 * @returns Array of newly awarded badges
 */
export async function evaluateContributorBadges(
  contributor: string,
  triggerBounty?: BountyRecord,
): Promise<BadgeRecord[]> {
  const newlyAwarded = evaluateContributorBadgesSync(contributor, triggerBounty);

  // Dispatch notifications and logs for each newly awarded badge
  for (const badge of newlyAwarded) {
    const recipients: NotificationRecipient[] = [
      { role: "contributor", address: contributor },
    ];

    sendNotification(recipients, "badge_earned", {
      badgeId: badge.badgeId,
      badgeName: badge.name,
      badgeDescription: badge.description,
      awardedAt: badge.awardedAt,
      contributor,
      metadata: badge.metadata,
    }).catch((err) =>
      logStructured("warn", "notification_failed", {
        operation: "evaluateContributorBadges",
        badgeId: badge.badgeId,
        contributor,
        message: err instanceof Error ? err.message : String(err),
      }),
    );

    logStructured("info", "badge_awarded", {
      contributor,
      badgeId: badge.badgeId,
      badgeName: badge.name,
      awardedAt: badge.awardedAt,
    });
  }

  return newlyAwarded;
}

/**
 * Returns all earned badges for a contributor in chronological order.
 * Automatically evaluates eligibility on read.
 *
 * @param contributor - Stellar address of the contributor
 * @returns Array of earned BadgeRecords
 */
export function getContributorBadges(contributor: string): BadgeRecord[] {
  evaluateContributorBadgesSync(contributor);
  return readBadgesStore()
    .filter((b) => b.contributor === contributor)
    .sort((a, b) => a.awardedAt - b.awardedAt);
}
