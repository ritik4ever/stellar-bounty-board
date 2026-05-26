import React, { memo, ReactNode, useCallback } from "react";
import { ArrowUpRight } from "lucide-react";
import { actionCopy as defaultActionCopy, statusCopy as defaultStatusCopy, type Action } from "./constants";
import type { Bounty, BountyStatus } from "./types";

type StatusCopy = typeof defaultStatusCopy;
type ActionCopy = typeof defaultActionCopy;

interface BountyCardProps {
  bounty: Bounty;
  statusCopy: StatusCopy;
  actionCopy: ActionCopy;
  renderActionButton: (bounty: Bounty, action: Action) => ReactNode;
  onOpen: (bountyId: string) => void;
}

function labelsEqual(a: Bounty["labels"], b: Bounty["labels"]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((label, index) => label.name === b[index]?.name && label.color === b[index]?.color);
}

function visibleBountyFieldsEqual(a: Bounty, b: Bounty): boolean {
  return (
    a.id === b.id &&
    a.repo === b.repo &&
    a.issueNumber === b.issueNumber &&
    a.title === b.title &&
    a.summary === b.summary &&
    a.maintainer === b.maintainer &&
    a.contributor === b.contributor &&
    a.status === b.status &&
    a.deadlineAt === b.deadlineAt &&
    a.submissionUrl === b.submissionUrl &&
    a.releasedTxHash === b.releasedTxHash &&
    a.refundedTxHash === b.refundedTxHash &&
    labelsEqual(a.labels, b.labels)
  );
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

function BountyCard({
  bounty,
  statusCopy,
  actionCopy,
  renderActionButton,
  onOpen,
}: BountyCardProps) {
  const handleOpen = useCallback(() => {
    onOpen(bounty.id);
  }, [bounty.id, onOpen]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen(bounty.id);
      }
    },
    [bounty.id, onOpen],
  );

  const status = statusCopy[bounty.status];

  return (
    <article
      className="bounty-card"
      role="link"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
    >
      <div className="bounty-card__top">
        <div>
          <span
            className={`status-pill status-pill--${bounty.status}`}
            title={status.description}
            aria-label={`${status.label}: ${status.description}`}
          >
            {status.label}
          </span>
          <h3>{bounty.title}</h3>
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
              onClick={(event) => event.stopPropagation()}
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
        <div>
          <span className="meta-label">Contributor</span>
          <strong>{bounty.contributor ? shortAddress(bounty.contributor) : "Open"}</strong>
        </div>
        {bounty.status === "released" && bounty.releasedTxHash && (
          <div>
            <span className="meta-label">Release tx</span>
            <strong>{`${bounty.releasedTxHash.slice(0, 10)}...`}</strong>
          </div>
        )}
        {bounty.status === "refunded" && bounty.refundedTxHash && (
          <div>
            <span className="meta-label">Refund tx</span>
            <strong>{`${bounty.refundedTxHash.slice(0, 10)}...`}</strong>
          </div>
        )}
      </div>

      <div className="chip-row">
        {bounty.labels.map((label) => (
          <span className="chip" key={label.name}>
            {label.name}
          </span>
        ))}
      </div>

      <p className="status-helper">
        <strong>{status.label}:</strong> {status.description}
      </p>

      {bounty.submissionUrl && (
        <a
          className="submission-link"
          href={bounty.submissionUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          Review submission <ArrowUpRight size={16} />
        </a>
      )}

      <div className="action-row">
        {(actionCopy[bounty.status as BountyStatus] ?? []).map((action) => renderActionButton(bounty, action))}
      </div>
    </article>
  );
}

export function bountyCardPropsEqual(prev: BountyCardProps, next: BountyCardProps): boolean {
  return (
    visibleBountyFieldsEqual(prev.bounty, next.bounty) &&
    prev.statusCopy === next.statusCopy &&
    prev.actionCopy === next.actionCopy &&
    prev.renderActionButton === next.renderActionButton &&
    prev.onOpen === next.onOpen
  );
}

export default memo(BountyCard, bountyCardPropsEqual);
