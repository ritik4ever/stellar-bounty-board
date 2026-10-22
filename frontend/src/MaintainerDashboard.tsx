import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, ShieldAlert, Sparkles } from 'lucide-react';
import type { Bounty, BountyStatus } from './types';
import { statusCopy } from './constants';
import UsdAmount from './UsdAmount';

export interface MaintainerDashboardProps {
  bounties: Bounty[];
  maintainerAddress?: string;
  loading?: boolean;
  onSelectBounty?: (id: string) => void;
  onRelease?: (bounty: Bounty) => void;
  onRefund?: (bounty: Bounty) => void;
}

/**
 * Assigns an urgency weight to bounty statuses so bounties requiring maintainer
 * action (submitted work, active disputes) are prioritized at the top.
 */
export function getActionUrgencyScore(status: BountyStatus): number {
  switch (status) {
    case 'submitted':
      return 100; // Highest urgency: contributor completed work awaiting maintainer review/release
    case 'disputed':
      return 90; // High urgency: dispute pending resolution
    case 'reserved':
      return 50; // Contributor working against deadline
    case 'open':
      return 20; // Available for reservation
    case 'released':
      return 5;
    case 'refunded':
      return 5;
    case 'expired':
      return 1;
    default:
      return 0;
  }
}

/**
 * Sorts bounties by urgency of maintainer action required.
 */
export function sortBountiesByActionUrgency(bounties: Bounty[]): Bounty[] {
  return [...bounties].sort((a, b) => {
    const urgencyDiff = getActionUrgencyScore(b.status) - getActionUrgencyScore(a.status);
    if (urgencyDiff !== 0) return urgencyDiff;

    // Secondary sort: most recently submitted or disputed first
    const timeA = a.submittedAt ?? a.createdAt;
    const timeB = b.submittedAt ?? b.createdAt;
    return timeB - timeA;
  });
}

export default function MaintainerDashboard({
  bounties,
  maintainerAddress = '',
  loading = false,
  onSelectBounty,
  onRelease,
  onRefund,
}: MaintainerDashboardProps) {
  const [addressInput, setAddressInput] = useState(maintainerAddress);
  const activeAddress = (maintainerAddress || addressInput).trim();

  // 1. Filter to bounties created by the maintainer
  const maintainerBounties = useMemo(() => {
    if (!activeAddress) {
      return bounties;
    }
    return bounties.filter((b) => b.maintainer.toLowerCase() === activeAddress.toLowerCase());
  }, [bounties, activeAddress]);

  // 2. Sort by urgency of required maintainer action
  const sortedBounties = useMemo(() => {
    return sortBountiesByActionUrgency(maintainerBounties);
  }, [maintainerBounties]);

  // Summary counts of actionable items
  const submittedCount = maintainerBounties.filter((b) => b.status === 'submitted').length;
  const disputedCount = maintainerBounties.filter((b) => b.status === 'disputed').length;
  const openCount = maintainerBounties.filter((b) => b.status === 'open').length;
  const reservedCount = maintainerBounties.filter((b) => b.status === 'reserved').length;

  return (
    <section className="maintainer-dashboard" aria-label="Maintainer Dashboard">
      <div className="maintainer-dashboard__header">
        <div className="maintainer-dashboard__title-wrap">
          <h2 className="maintainer-dashboard__title">Maintainer Action Hub</h2>
          <p className="maintainer-dashboard__subtitle">
            Prioritized action queue for bounties you created. Review submissions and resolve
            disputes first.
          </p>
        </div>

        {!maintainerAddress && (
          <div className="maintainer-dashboard__address-filter">
            <label htmlFor="maintainer-address-input">Maintainer Public Key:</label>
            <input
              id="maintainer-address-input"
              type="text"
              placeholder="Filter by Stellar address (G...)"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              className="maintainer-address-input"
            />
          </div>
        )}
      </div>

      {/* Urgency Summary Badges */}
      <div className="maintainer-summary-strip" role="region" aria-label="Action Summary">
        <div className={`summary-pill ${submittedCount > 0 ? 'summary-pill--urgent' : ''}`}>
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            <strong>{submittedCount}</strong> Submissions to Review
          </span>
        </div>
        <div className={`summary-pill ${disputedCount > 0 ? 'summary-pill--warning' : ''}`}>
          <ShieldAlert size={16} aria-hidden="true" />
          <span>
            <strong>{disputedCount}</strong> Disputes Pending
          </span>
        </div>
        <div className="summary-pill">
          <Clock size={16} aria-hidden="true" />
          <span>
            <strong>{reservedCount}</strong> In Progress
          </span>
        </div>
        <div className="summary-pill">
          <Sparkles size={16} aria-hidden="true" />
          <span>
            <strong>{openCount}</strong> Open Bounties
          </span>
        </div>
      </div>

      {loading ? (
        <div className="maintainer-dashboard__loading" aria-live="polite">
          Loading maintainer bounties...
        </div>
      ) : sortedBounties.length === 0 ? (
        <div className="maintainer-dashboard__empty" role="status">
          <h3>No bounties found</h3>
          <p>
            {activeAddress
              ? `No bounties found created by maintainer ${activeAddress}.`
              : 'No maintainer bounties available.'}
          </p>
        </div>
      ) : (
        <div
          className="maintainer-bounty-list"
          role="feed"
          aria-label="Prioritized Maintainer Bounties"
        >
          {sortedBounties.map((bounty) => {
            const isUrgent = bounty.status === 'submitted' || bounty.status === 'disputed';
            return (
              <article
                key={bounty.id}
                className={`maintainer-card maintainer-card--${bounty.status} ${
                  isUrgent ? 'maintainer-card--needs-action' : ''
                }`}
                tabIndex={0}
                onClick={() => onSelectBounty?.(bounty.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectBounty?.(bounty.id);
                  }
                }}
              >
                <div className="maintainer-card__top">
                  <span className={`status-tag status-tag--${bounty.status}`}>
                    {statusCopy[bounty.status]?.label ?? bounty.status}
                  </span>
                  {bounty.status === 'submitted' && (
                    <span className="urgency-badge urgency-badge--action">⚠️ Needs Review</span>
                  )}
                  {bounty.status === 'disputed' && (
                    <span className="urgency-badge urgency-badge--dispute">⚖️ Action Needed</span>
                  )}
                  <span className="maintainer-card__reward">
                    <UsdAmount amount={bounty.amount} tokenSymbol={bounty.tokenSymbol} />
                  </span>
                </div>

                <h3 className="maintainer-card__title">
                  #{bounty.issueNumber} {bounty.title}
                </h3>
                <p className="maintainer-card__repo">{bounty.repo}</p>

                {bounty.submissionUrl && (
                  <div className="maintainer-card__submission">
                    <strong>Submission:</strong>{' '}
                    <a
                      href={bounty.submissionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {bounty.submissionUrl}
                    </a>
                  </div>
                )}

                <div className="maintainer-card__footer">
                  <span className="maintainer-card__id">{bounty.id}</span>
                  <div className="maintainer-card__actions" onClick={(e) => e.stopPropagation()}>
                    {bounty.status === 'submitted' && onRelease && (
                      <button
                        type="button"
                        className="primary-button maintainer-btn-release"
                        onClick={() => onRelease(bounty)}
                      >
                        <CheckCircle2 size={14} aria-hidden="true" />
                        Approve & Release
                      </button>
                    )}
                    {(bounty.status === 'open' || bounty.status === 'submitted') && onRefund && (
                      <button
                        type="button"
                        className="ghost-button maintainer-btn-refund"
                        onClick={() => onRefund(bounty)}
                      >
                        Refund Escrow
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onSelectBounty?.(bounty.id)}
                    >
                      View Details
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
