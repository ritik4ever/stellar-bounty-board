import { listBounties, type BountyRecord } from "./bountyStore";

/**
 * Reputation scoring formula
 * ==========================
 * The aggregate score is an integer from 0 to 100 derived from three
 * independent components:
 *
 * 1. Completion score (0–60)
 *    Each released bounty contributes +15 points, capped at 60.
 *    A contributor who has completed at least 4 bounties earns the
 *    maximum completion score.
 *
 * 2. Dispute resolution score (-30 to +20)
 *    Each dispute resolved in the contributor's favour (released after
 *    dispute) adds +10, capped at +20.
 *    Each dispute resolved against the contributor (refunded after
 *    dispute) subtracts 15.
 *
 * 3. Response time score (0–20)
 *    Measures how quickly the contributor completed work relative to
 *    the bounty deadline.  The ratio is computed per bounty as:
 *
 *      response_ratio = (deadlineAt - reservedAt) / (deadlineAt - createdAt)
 *
 *    A lower ratio means faster completion.  The contributor's average
 *    ratio is mapped to a bonus:
 *      • ≤ 0.25 (finished in ≤ 25 % of the allotted time) → +20
 *      • ≤ 0.50 → +10
 *      • otherwise → 0
 *
 * Base score: 50
 * Final = clamp(base + completion + dispute + responseTime, 0, 100)
 *
 * When a contributor has no bounty history the service returns a neutral
 * score of 50 with all components zeroed.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-factor breakdown of the reputation score. */
export interface ReputationBreakdown {
  /** Points earned from completed (released) bounties. 0–60. */
  completionScore: number;
  /** Points from dispute outcomes. -30 to +20. */
  disputeScore: number;
  /** Points from response-time performance. 0–20. */
  responseTimeScore: number;
}

/** Full reputation response for a contributor. */
export interface ContributorReputation {
  /** Stellar address of the contributor. */
  address: string;
  /** Aggregate reputation score, clamped to 0–100. */
  score: number;
  /** Factor-level breakdown of the score. */
  breakdown: ReputationBreakdown;
  /** Total number of bounties the contributor has worked on (all statuses). */
  totalBounties: number;
  /** Number of bounties successfully released. */
  completedBounties: number;
  /** Number of disputes resolved in the contributor's favour. */
  disputeWins: number;
  /** Number of disputes resolved against the contributor. */
  disputeLosses: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_SCORE = 50;
const COMPLETION_POINTS_PER_BOUNTY = 15;
const COMPLETION_CAP = 60;
const DISPUTE_WIN_POINTS = 10;
const DISPUTE_WIN_CAP = 20;
const DISPUTE_LOSS_PENALTY = 15;
const RESPONSE_TIME_EXCELLENT = 0.25;
const RESPONSE_TIME_GOOD = 0.5;
const RESPONSE_TIME_EXCELLENT_BONUS = 20;
const RESPONSE_TIME_GOOD_BONUS = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute the response-time ratio for a single bounty.
 *
 * The ratio measures what fraction of the allotted time the contributor
 * actually used:
 *
 *   (deadlineAt - reservedAt) / (deadlineAt - createdAt)
 *
 * A value of 0 means the contributor finished instantly; 1 means they
 * used every second up to the deadline.
 *
 * Returns `null` when the data needed for the calculation is missing
 * (no reservation, no timestamps, or zero-length window).
 */
function responseRatio(bounty: BountyRecord): number | null {
  if (!bounty.reservedAt) return null;

  const window = bounty.deadlineAt - bounty.createdAt;
  if (window <= 0) return null;

  const used = bounty.deadlineAt - bounty.reservedAt;
  return used / window;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the reputation score for a contributor identified by their
 * Stellar address.
 *
 * @param address - Stellar public key of the contributor.
 * @returns The reputation score and its component breakdown.
 */
export function getContributorReputation(
  address: string,
): ContributorReputation {
  const allBounties = listBounties();
  const contributorBounties = allBounties.filter(
    (b) => b.contributor === address,
  );

  const totalBounties = contributorBounties.length;

  // No history → neutral score
  if (totalBounties === 0) {
    return {
      address,
      score: BASE_SCORE,
      breakdown: {
        completionScore: 0,
        disputeScore: 0,
        responseTimeScore: 0,
      },
      totalBounties: 0,
      completedBounties: 0,
      disputeWins: 0,
      disputeLosses: 0,
    };
  }

  // ── Completion score ──────────────────────────────────────────────────
  const released = contributorBounties.filter(
    (b) => b.status === "released",
  );
  const completionScore = Math.min(
    released.length * COMPLETION_POINTS_PER_BOUNTY,
    COMPLETION_CAP,
  );

  // ── Dispute score ─────────────────────────────────────────────────────
  const disputes = contributorBounties.filter(
    (b) =>
      b.status === "released" || b.status === "refunded",
  ).filter((b) =>
    b.events.some((e) => e.type === "disputed"),
  );

  let disputeWins = 0;
  let disputeLosses = 0;

  for (const b of disputes) {
    const lastEvent = b.events[b.events.length - 1];
    if (lastEvent.type === "released") {
      disputeWins++;
    } else {
      disputeLosses++;
    }
  }

  const disputeScore =
    Math.min(disputeWins * DISPUTE_WIN_POINTS, DISPUTE_WIN_CAP) -
    disputeLosses * DISPUTE_LOSS_PENALTY;

  // ── Response time score ───────────────────────────────────────────────
  const ratios: number[] = [];
  for (const b of contributorBounties) {
    const r = responseRatio(b);
    if (r !== null) {
      ratios.push(r);
    }
  }

  let responseTimeScore = 0;
  if (ratios.length > 0) {
    const avgRatio =
      ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
    if (avgRatio <= RESPONSE_TIME_EXCELLENT) {
      responseTimeScore = RESPONSE_TIME_EXCELLENT_BONUS;
    } else if (avgRatio <= RESPONSE_TIME_GOOD) {
      responseTimeScore = RESPONSE_TIME_GOOD_BONUS;
    }
  }

  // ── Aggregate ─────────────────────────────────────────────────────────
  const score = clamp(
    BASE_SCORE + completionScore + disputeScore + responseTimeScore,
    0,
    100,
  );

  return {
    address,
    score,
    breakdown: {
      completionScore,
      disputeScore,
      responseTimeScore,
    },
    totalBounties,
    completedBounties: released.length,
    disputeWins,
    disputeLosses,
  };
}
