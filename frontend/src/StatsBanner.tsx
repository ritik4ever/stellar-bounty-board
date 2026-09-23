import React from "react";
import { type GlobalMetrics } from "./types";
import { Coins, Flame, Award } from "lucide-react";

interface StatsBannerProps {
  metrics: GlobalMetrics | null;
  loading?: boolean;
}

export const StatsBanner: React.FC<StatsBannerProps> = ({ metrics, loading }) => {
  if (loading && !metrics) {
    return (
      <div className="stats-banner-container loading" data-testid="stats-banner-loading">
        <div className="stat-card skeleton">Loading platform statistics...</div>
      </div>
    );
  }

  const totalBounties = metrics?.totalBounties ?? 0;
  const openCount = metrics?.openCount ?? 0;
  const totalFunded = metrics?.totalFunded ?? 0;

  return (
    <div className="stats-banner-grid" data-testid="stats-banner">
      <div className="stat-card">
        <div className="stat-icon-wrapper blue">
          <Award size={20} />
        </div>
        <div className="stat-details">
          <span className="stat-label">Total Bounties</span>
          <span className="stat-value">{totalBounties.toLocaleString()}</span>
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-icon-wrapper green">
          <Coins size={20} />
        </div>
        <div className="stat-details">
          <span className="stat-label">XLM Locked / Funded</span>
          <span className="stat-value">{totalFunded.toLocaleString()} XLM</span>
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-icon-wrapper orange">
          <Flame size={20} />
        </div>
        <div className="stat-details">
          <span className="stat-label">Open Bounties</span>
          <span className="stat-value">{openCount.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
};

export default StatsBanner;
