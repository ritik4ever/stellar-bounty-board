import { ArrowUpRight, Star, TrendingUp } from "lucide-react";
import { BountyRecommendation } from "./recommendations";
import { Bounty, BountyStatus } from "./types";
import { statusCopy } from "./constants";

interface RecommendedBountiesProps {
  recommendations: BountyRecommendation[];
  loading?: boolean;
}

function formatRelativeDeadline(deadlineAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadlineAt - now;
  const days = Math.ceil(Math.abs(diff) / (24 * 60 * 60));
  if (diff >= 0) {
    return `${days} day${days === 1 ? "" : "s"} left`;
  }
  return `${days} day${days === 1 ? "" : "s"} overdue`;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function BountyRecommendationCard({ recommendation }: { recommendation: BountyRecommendation }) {
  const { bounty, score, reasons } = recommendation;

  return (
    <article className="bounty-card bounty-card--recommended">
      <div className="bounty-card__recommended-header">
        <div className="recommendation-score">
          <Star size={16} />
          <span>{Math.round(score * 100)}% match</span>
        </div>
        <div className="recommendation-reasons">
          {reasons.map((reason, index) => (
            <span key={index} className="reason-tag">
              {reason}
            </span>
          ))}
        </div>
      </div>

      <div className="bounty-card__top">
        <div>
          <span
            className={`status-pill status-pill--${bounty.status}`}
            title={statusCopy[bounty.status].description}
            aria-label={`${statusCopy[bounty.status].label}: ${statusCopy[bounty.status].description}`}
          >
            {statusCopy[bounty.status].label}
          </span>
          <h3>{bounty.title}</h3>
        </div>
        <div className="amount-chip">
          {bounty.amount} {bounty.tokenSymbol}
        </div>
      </div>

      <p className="bounty-summary">{bounty.summary}</p>

      <div className="meta-grid">
        <div>
          <span className="meta-label">Issue</span>
          <strong>
            <a
              className="inline-link"
              href={`https://github.com/${bounty.repo}/issues/${bounty.issueNumber}`}
              target="_blank"
              rel="noreferrer"
            >
              {bounty.repo} #{bounty.issueNumber}
            </a>
          </strong>
        </div>
        <div>
          <span className="meta-label">Deadline</span>
          <strong>{formatRelativeDeadline(bounty.deadlineAt)}</strong>
        </div>
        <div>
          <span className="meta-label">Maintainer</span>
          <strong>{shortAddress(bounty.maintainer)}</strong>
        </div>
      </div>

      <div className="chip-row">
        {bounty.labels.map((label) => (
          <span className="chip" key={label}>
            {label}
          </span>
        ))}
      </div>

      <div className="recommendation-footer">
        <div className="recommendation-explanation">
          <TrendingUp size={14} />
          <span>Recommended for you</span>
        </div>
        <a
          className="secondary-link"
          href={`https://github.com/${bounty.repo}/issues/${bounty.issueNumber}`}
          target="_blank"
          rel="noreferrer"
        >
          View issue <ArrowUpRight size={16} />
        </a>
      </div>
    </article>
  );
}

export default function RecommendedBounties({ recommendations, loading }: RecommendedBountiesProps) {
  if (loading) {
    return (
      <section className="panel recommendations-panel">
        <div className="panel-header">
          <div>
            <span className="panel-kicker">Personalized for you</span>
            <h2>Recommended bounties</h2>
          </div>
          <Star size={18} />
        </div>
        <div className="board-list">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bounty-card bounty-card--skeleton">
              <div className="skeleton-line" style={{ width: '60%', height: '20px' }} />
              <div className="skeleton-line" style={{ width: '40%', height: '16px' }} />
              <div className="skeleton-line" style={{ width: '80%', height: '14px' }} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (recommendations.length === 0) {
    return (
      <section className="panel recommendations-panel">
        <div className="panel-header">
          <div>
            <span className="panel-kicker">Personalized for you</span>
            <h2>Recommended bounties</h2>
          </div>
          <Star size={18} />
        </div>
        <div className="empty-state">
          <p>No recommendations available yet. Complete some bounties to get personalized suggestions!</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel recommendations-panel">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">Personalized for you</span>
          <h2>Recommended bounties</h2>
          <p className="panel-description">
            Based on your contribution history and preferences
          </p>
        </div>
        <Star size={18} />
      </div>

      <div className="board-list">
        {recommendations.map((recommendation) => (
          <BountyRecommendationCard key={recommendation.bounty.id} recommendation={recommendation} />
        ))}
      </div>

      <div className="recommendations-footer">
        <p className="recommendations-disclaimer">
          Recommendations are based on labels you've worked with, repositories you're familiar with, 
          and reward amounts that match your history.
        </p>
      </div>
    </section>
  );
}
