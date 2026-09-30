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

/** Returns true if dark text is readable on the given hex background per WCAG relative luminance (contrast >= 4.5:1). */
function useDarkText(hex: string): boolean {
  if (hex.length < 6) return false;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return (L + 0.05) / 0.05 >= 4.5;
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
    <div className="chip-row" role="list" aria-label="Issue labels">
      {visibleLabels.map((label) => {
        const bg = `#${label.color}`;
        const color = useDarkText(label.color) ? "#1a1a1a" : "#ffffff";
        return (
          <span
            key={label.name}
            role="listitem"
            className="chip"
            style={{ backgroundColor: bg, color, border: "none" }}
          >
            {label.name}
          </span>
        );
      })}
      {overflowCount > 0 && (
        <span
          role="listitem"
          className="chip"
          aria-label={`${overflowCount} more labels`}
        >
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
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading GitHub issue preview"
    >
      <div className="github-issue-card__top">
        <div className="github-issue-card__heading">
          <span className="skeleton-block github-issue-card__skeleton-icon" aria-hidden="true" />
          <span className="skeleton-block github-issue-card__skeleton-repo" aria-hidden="true" />
          <span className="skeleton-block github-issue-card__skeleton-number" aria-hidden="true" />
        </div>
        <span className="skeleton-block github-issue-card__skeleton-cta" aria-hidden="true" />
      </div>
      <span className="skeleton-block github-issue-card__skeleton-title" aria-hidden="true" />
      <div className="chip-row" aria-hidden="true">
        <span className="skeleton-block github-issue-card__skeleton-chip" />
        <span className="skeleton-block github-issue-card__skeleton-chip" />
      </div>
    </div>
  );
}

type CardShellProps = {
  href?: string;
  disabled?: boolean;
  ariaLabel?: string;
  children: ReactNode;
};

function CardShell({ href, disabled, ariaLabel, children }: CardShellProps) {
  if (disabled || !href) {
    return (
      <div
        className="github-issue-card github-issue-card--disabled"
        aria-disabled="true"
        role="region"
        aria-label={ariaLabel ?? "GitHub issue preview"}
      >
        {children}
      </div>
    );
  }

  return (
    <a
      className="github-issue-card"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={ariaLabel}
    >
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
      <CardShell disabled ariaLabel="GitHub issue preview">
        <div className="github-issue-card__top">
          <div className="github-issue-card__heading">
            <FolderGit2 size={16} aria-hidden="true" />
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
      <div
        className="github-issue-card github-issue-card--error"
        role="region"
        aria-label={`GitHub issue preview for ${normalizedRepo} #${issueNumber}`}
      >
        <div className="github-issue-card__top">
          <div className="github-issue-card__heading">
            <FolderGit2 size={16} aria-hidden="true" />
            <span className="github-issue-card__repo">{normalizedRepo}</span>
            <span className="github-issue-card__number">#{issueNumber}</span>
          </div>
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
          {href && (
            <a
              className="github-issue-card__error-link"
              href={href}
              target="_blank"
              rel="noreferrer"
            >
              View issue on GitHub <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    );
  }

  const cardAriaLabel = `Issue #${issueNumber}: ${issue?.title ?? "preview"} on ${normalizedRepo}`;

  return (
    <CardShell href={href} ariaLabel={cardAriaLabel}>
      <div className="github-issue-card__top">
        <div className="github-issue-card__heading">
          <FolderGit2 size={16} aria-hidden="true" />
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
        <span className="github-issue-card__cta" aria-hidden="true">
          View on GitHub <ArrowUpRight size={16} aria-hidden="true" />
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
