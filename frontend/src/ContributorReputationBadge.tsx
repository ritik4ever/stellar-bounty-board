import { ShieldCheck } from 'lucide-react';

import type { ContributorReputation, ReputationLevel } from './types';

const LEVEL_LABELS: Record<ReputationLevel, string> = {
  rising: 'Rising contributor',
  trusted: 'Trusted contributor',
  veteran: 'Veteran contributor',
};

interface ContributorReputationBadgeProps {
  reputation: ContributorReputation | null;
  loading?: boolean;
}

/**
 * Track-record badge for a contributor, sourced from prior released bounties
 * (#1459).
 *
 * Renders nothing while loading and nothing for first-time contributors: a
 * `0` would read as a bad track record when the truth is simply "no history
 * yet". Maintainers should see confidence when it exists, not noise when it
 * does not.
 */
export default function ContributorReputationBadge({
  reputation,
  loading = false,
}: ContributorReputationBadgeProps) {
  if (loading || !reputation || reputation.isFirstTime || reputation.reputation === null) {
    return null;
  }

  const completedLabel = `${reputation.reputation} ${
    reputation.reputation === 1 ? 'bounty' : 'bounties'
  } completed`;

  return (
    <span
      className="reputation-badge"
      title={`Reputation from ${completedLabel} on released bounties`}
    >
      <ShieldCheck size={14} aria-hidden="true" />
      <span className="reputation-badge__count">{completedLabel}</span>
      {reputation.level && (
        <span className={`reputation-badge__level reputation-badge__level--${reputation.level}`}>
          {LEVEL_LABELS[reputation.level]}
        </span>
      )}
      {reputation.totalEarned > 0 && (
        <span className="reputation-badge__earned">
          {reputation.totalEarned.toLocaleString(undefined, { maximumFractionDigits: 2 })} earned
        </span>
      )}
    </span>
  );
}
