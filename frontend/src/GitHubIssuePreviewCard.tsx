import { ArrowUpRight, FolderGit2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { fetchGithubIssue, type GithubIssueData, type GithubIssueLabel } from "./githubIssueApi";

type Props = {
  repo: string;
  issueNumber: number;
};

function isValidRepo(value: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(value.trim());
}

/** Returns true if dark text (#000) is readable on the given hex background. */
function useDarkText(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

function formatIssueDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const MAX_LABELS = 3;

function IssueLabels({ labels }: { labels: GithubIssueLabel[] }) {
  const visibleLabels = labels.slice(0, MAX_LABELS);
  const overflowCount = labels.length - visibleLabels.length;

  if (labels.length === 0) {
    return <div className="github-issue-card__empty">No labels on this issue.</div>;
  }

  return (
    <div className="chip-row" aria-label="Issue labels">
      {visibleLabels.map((label) => {
        const bg = `#${label.color}`;
        const color = useDarkText(label.color) ? "#1a1a1a" : "#ffffff";
        return (
          <span
            key={label.name}
            className="chip"
            style={{ backgroundColor: bg, color, border: "none" }}
          >
            {label.name}
          </span>
        );
      })}
      {overflowCount > 0 && (
        <span className="chip" aria-label={`${overflowCount} more labels`}>
          +{overflowCount} more
        </span>
      )}
    </div>
  );
}

function GitHubIssuePreviewCardSkeleton() {
  return (
    <div
      className="github-issue-card github-issue-card--loading"
      data-testid="github-issue-preview-loading"
      aria-busy="true"
      aria-label="Loading GitHub issue preview"
    >
      <div className="github-issue-card__top">
        <div className="github-issue-card__heading">
          <span className="skeleton-block github-issue-card__skeleton-icon" />
          <span className="skeleton-block github-issue-card__skeleton-repo" />
          <span className="skeleton-block github-issue-card__skeleton-number" />
        </div>
        <span className="skeleton-block github-issue-card__skeleton-cta" />
      </div>
      <span className="skeleton-block github-issue-card__skeleton-title" />
      <div className="chip-row">
        <span className="skeleton-block github-issue-card__skeleton-chip" />
        <span className="skeleton-block github-issue-card__skeleton-chip" />
      </div>
    </div>
  );
}

type CardShellProps = {
  href?: string;
  disabled?: boolean;
  children: ReactNode;
};

function CardShell({ href, disabled, children }: CardShellProps) {
  if (disabled || !href) {
    return (
      <div className="github-issue-card github-issue-card--disabled" aria-disabled="true">
        {children}
      </div>
    );
  }

  return (
    <a className="github-issue-card" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export default function GitHubIssuePreviewCard({ repo, issueNumber }: Props) {
  const normalizedRepo = repo.trim();
  const canLink = isValidRepo(normalizedRepo) && Number.isFinite(issueNumber) && issueNumber > 0;
  const href = canLink ? `https://github.com/${normalizedRepo}/issues/${issueNumber}` : undefined;

  const [issue, setIssue] = useState<GithubIssueData | null>(null);
  const [loading, setLoading] = useState(canLink);
  const [error, setError] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);

  useEffect(() => {
    if (!canLink) {
      setLoading(false);
      setIssue(null);
      setError(false);
      setRateLimited(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(false);
    setRateLimited(false);
    setIssue(null);

    void fetchGithubIssue(normalizedRepo, issueNumber).then((result) => {
      if (!active) return;

      if (result.ok) {
        setIssue(result.data);
        setLoading(false);
        return;
      }

      setError(true);
      setRateLimited(result.rateLimited);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [canLink, normalizedRepo, issueNumber]);

  if (!canLink) {
    return (
      <CardShell disabled>
        <div className="github-issue-card__top">
          <div className="github-issue-card__heading">
            <FolderGit2 size={16} />
            <span className="github-issue-card__repo">owner/repo</span>
            <span className="github-issue-card__number">#—</span>
          </div>
        </div>
        <strong className="github-issue-card__title">Issue title preview</strong>
        <div className="github-issue-card__empty">Add labels to help contributors filter.</div>
      </CardShell>
    );
  }

  if (loading) {
    return <GitHubIssuePreviewCardSkeleton />;
  }

  if (error) {
    return (
      <CardShell href={href}>
        <div className="github-issue-card__top">
          <div className="github-issue-card__heading">
            <FolderGit2 size={16} />
            <span className="github-issue-card__repo">{normalizedRepo}</span>
            <span className="github-issue-card__number">#{issueNumber}</span>
          </div>
          <span className="github-issue-card__cta">
            View on GitHub <ArrowUpRight size={16} />
          </span>
        </div>
        <div className="github-issue-card__error" role="alert">
          <p>Could not load issue details from GitHub.</p>
          {rateLimited ? (
            <p className="github-issue-card__rate-limit">
              Unauthenticated API requests are rate-limited. Open the issue on GitHub to view
              details.
            </p>
          ) : (
            <p>The issue may be private or unavailable.</p>
          )}
          <a className="github-issue-card__error-link" href={href} target="_blank" rel="noreferrer">
            View issue on GitHub <ArrowUpRight size={14} />
          </a>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell href={href}>
      <div className="github-issue-card__top">
        <div className="github-issue-card__heading">
          <FolderGit2 size={16} />
          <span className="github-issue-card__repo">{normalizedRepo}</span>
          <span className="github-issue-card__number">#{issueNumber}</span>
          {issue ? (
            <span
              className={`github-issue-card__state github-issue-card__state--${issue.state}`}
            >
              {issue.state}
            </span>
          ) : null}
        </div>
        <span className="github-issue-card__cta">
          View on GitHub <ArrowUpRight size={16} />
        </span>
      </div>

      <strong className="github-issue-card__title">{issue?.title ?? "Issue title preview"}</strong>

      {issue ? (
        <p className="github-issue-card__opened">
          Opened <time dateTime={issue.createdAt}>{formatIssueDate(issue.createdAt)}</time>
        </p>
      ) : null}

      <IssueLabels labels={issue?.labels ?? []} />
    </CardShell>
  );
}
