import { Coins, LayoutGrid, Lock } from 'lucide-react';

import type { GlobalMetrics } from './types';

interface StatsBannerProps {
  stats: GlobalMetrics | null;
  loading?: boolean;
}

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Platform stats header for the dashboard (#1458).
 *
 * Consumes `GET /api/stats` (the wave-4 #19 summary) through the parent, which
 * refreshes it on the same poll as the bounty list so the numbers track the
 * underlying data without a dedicated subscription.
 *
 * Shows total bounties, XLM currently locked in escrow, and the open count.
 * Renders nothing until the first successful fetch so a slow backend never
 * leaves an empty shell behind.
 */
export default function StatsBanner({ stats, loading = false }: StatsBannerProps) {
  if (!stats) {
    return loading ? (
      <section
        className="stats-banner stats-banner--loading"
        aria-busy="true"
        aria-label="Loading platform stats"
      >
        <span className="stats-banner__skeleton" />
        <span className="stats-banner__skeleton" />
        <span className="stats-banner__skeleton" />
      </section>
    ) : null;
  }

  // Funds paid out are no longer escrowed, so "locked" is what remains funded
  // but unreleased. Clamp at zero in case of drift in the underlying numbers.
  const locked = Math.max(0, stats.totalFunded - stats.totalReleased);

  return (
    <section className="stats-banner" aria-label="Platform statistics">
      <div className="stats-banner__item">
        <LayoutGrid size={18} aria-hidden="true" />
        <span className="stats-banner__label">Total bounties</span>
        <strong className="stats-banner__value">{stats.totalBounties.toLocaleString()}</strong>
      </div>
      <div className="stats-banner__item">
        <Lock size={18} aria-hidden="true" />
        <span className="stats-banner__label">XLM locked</span>
        <strong className="stats-banner__value">{formatAmount(locked)}</strong>
      </div>
      <div className="stats-banner__item">
        <Coins size={18} aria-hidden="true" />
        <span className="stats-banner__label">Open bounties</span>
        <strong className="stats-banner__value">{stats.openCount.toLocaleString()}</strong>
      </div>
    </section>
  );
}
