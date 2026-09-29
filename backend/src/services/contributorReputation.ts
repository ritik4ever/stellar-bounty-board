import { listBounties } from "./bountyStore";

/**
 * Contributor reputation (#1459).
 *
 * A maintainer deciding whether to trust an unknown contributor wants one
 * signal: how many bounties has this address actually completed and been paid
 * for? That figure is derived here from released-bounty history only — a bounty
 * still open, reserved, or submitted proves nothing about delivery, so it does
 * not count toward reputation.
 *
 * First-time contributors get `null` rather than `0` so the UI can omit the
 * badge entirely instead of implying a bad track record.
 */

/** Coarse trust tier derived from the number of completed bounties. */
export type ReputationLevel = "rising" | "trusted" | "veteran";

export interface ContributorReputation {
  /** Stellar public key the reputation was looked up for. */
  address: string;
  /**
   * Number of successfully completed (released) bounties, or `null` when the
   * contributor has no completed work yet. `null` — not `0` — so the UI can
   * hide the badge for first-time contributors.
   */
  reputation: number | null;
  /** Completed bounty count (always a number, `0` for first-timers). */
  releasedCount: number;
  /** Total tokens paid out across released bounties. */
  totalEarned: number;
  /** Trust tier, or `null` for first-time contributors. */
  level: ReputationLevel | null;
  /** Convenience flag: true when the address has no released bounties. */
  isFirstTime: boolean;
}

/**
 * Ordered thresholds, highest first, so the first match wins.
 * - 1–2 completed → `rising`
 * - 3–4 completed → `trusted`
 * - 5+  completed → `veteran`
 */
const LEVEL_THRESHOLDS: Array<{ min: number; level: ReputationLevel }> = [
  { min: 5, level: "veteran" },
  { min: 3, level: "trusted" },
  { min: 1, level: "rising" },
];

/**
 * Derive a contributor's reputation from their released-bounty history.
 *
 * Pure and synchronous: reads the current bounty store, performs no I/O, and
 * always returns a fully populated object (never throws for an unknown
 * address — that address is simply a first-time contributor).
 *
 * @param address Stellar public key of the contributor.
 */
export function getContributorReputation(address: string): ContributorReputation {
  const released = listBounties().filter(
    (bounty) => bounty.status === "released" && bounty.contributor === address,
  );

  const releasedCount = released.length;
  const totalEarned = released.reduce((sum, bounty) => sum + bounty.amount, 0);
  const level = LEVEL_THRESHOLDS.find((entry) => releasedCount >= entry.min)?.level ?? null;

  return {
    address,
    reputation: releasedCount > 0 ? releasedCount : null,
    releasedCount,
    totalEarned,
    level,
    isFirstTime: releasedCount === 0,
  };
}
