import { ArrowUpRight, FolderGit2 } from 'lucide-react';

interface GithubLabel {
  name: string;
  color: string; // hex without '#'
}

type Props = {
  repo: string;
  issueNumber: number;
  title?: string;
  labels?: GithubLabel[];
};

function isValidRepo(value: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(value.trim());
}

/** Returns true if dark text (#000) is readable on the given hex background. */
function useDarkText(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Perceived luminance (WCAG formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

const MAX_LABELS = 3;

export default function GitHubIssuePreviewCard({ repo, issueNumber, title, labels }: Props) {
  const normalizedRepo = repo.trim();
  const canLink = isValidRepo(normalizedRepo) && Number.isFinite(issueNumber) && issueNumber > 0;
  const href = canLink ? `https://github.com/${normalizedRepo}/issues/${issueNumber}` : undefined;

  const safeLabels = labels ?? [];
  const visibleLabels = safeLabels.slice(0, MAX_LABELS);
  const overflowCount = safeLabels.length - visibleLabels.length;

  const content = (
    <>
      <div className="github-issue-card__top">
        <div className="github-issue-card__heading">
          <FolderGit2 size={16} />
          <span className="github-issue-card__repo">
            {isValidRepo(normalizedRepo) ? normalizedRepo : 'owner/repo'}
          </span>
          <span className="github-issue-card__number">{canLink ? `#${issueNumber}` : '#—'}</span>
        </div>
        <span className="github-issue-card__cta">
          View on GitHub <ArrowUpRight size={16} />
        </span>
      </div>

      <strong className="github-issue-card__title">
        {title?.trim() ? title : 'Issue title preview'}
      </strong>

      {safeLabels.length > 0 ? (
        <div className="chip-row" aria-label="Issue labels">
          {visibleLabels.map((label) => {
            const bg = `#${label.color}`;
            const color = useDarkText(label.color) ? '#1a1a1a' : '#ffffff';
            return (
              <span
                key={label.name}
                className="chip"
                style={{ backgroundColor: bg, color, border: 'none' }}
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
      ) : (
        <div className="github-issue-card__empty">Add labels to help contributors filter.</div>
      )}
    </>
  );

  if (!canLink) {
    return (
      <div className="github-issue-card github-issue-card--disabled" aria-disabled="true">
        {content}
      </div>
    );
  }

  return (
    <a className="github-issue-card" href={href} target="_blank" rel="noreferrer">
      {content}
    </a>
  );
}
