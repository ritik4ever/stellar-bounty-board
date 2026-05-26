
import { ReactNode, useCallback, useState } from "react";
import { ArrowUpRight, Check, Clock, Copy } from "lucide-react";
import type { Bounty, BountyEvent, BountyStatus } from "./types";
import UsdAmount from "./UsdAmount";

type BountyAction = "reserve" | "submit" | "release" | "refund";

type Props = {
  bounty: Bounty | null;
  loading: boolean;
  onBack: () => void;
  owner: string;
  avatarUrl: string;
  statusCopy: Record<BountyStatus, { label: string; description: string }>;
  actionCopy: Record<
    BountyStatus,
    Array<{ action: BountyAction; label: string; title: string }>
  >;
  renderActionButton: (
    bounty: Bounty,
    action: { action: BountyAction; label: string; title: string },
  ) => ReactNode;
  formatTimestamp: (value?: number) => string;
};

function useCopyToClipboard(timeout = 2000) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = useCallback(
    (text: string, key: string) => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), timeout);
      });
    },
    [timeout],
  );

  return { copiedKey, copy };
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { copiedKey, copy } = useCopyToClipboard();
  const copied = copiedKey !== null;

  return (
    <span className="copy-button-wrapper">
      <button
        type="button"
        className="copy-button"
        aria-label={copied ? "Copied!" : `Copy ${label}`}
        title={copied ? "Copied!" : `Copy ${label}`}
        onClick={() => copy(text, label)}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {copied && <span className="copy-tooltip">Copied</span>}
    </span>
  );
}

const EVENT_LABELS: Record<string, string> = {
  created: "Bounty created",
  reserved: "Bounty reserved",
  submitted: "Work submitted",
  released: "Payment released",
  refunded: "Bounty refunded",
  expired: "Bounty expired",
};

function BountyTimeline({ events, formatTimestamp }: { events: BountyEvent[]; formatTimestamp: (v?: number) => string }) {
  if (!events || events.length === 0) return null;

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className="bounty-timeline">
      <h3 className="bounty-timeline__title">
        <Clock size={16} />
        Activity timeline
      </h3>
      <ol className="bounty-timeline__list">
        {sorted.map((event, index) => (
          <li key={index} className={`bounty-timeline__item bounty-timeline__item--${event.type}`}>
            <div className="bounty-timeline__dot" aria-hidden="true" />
            <div className="bounty-timeline__content">
              <strong className="bounty-timeline__event">
                {EVENT_LABELS[event.type] ?? event.type}
              </strong>
              <time className="bounty-timeline__time" dateTime={new Date(event.timestamp * 1000).toISOString()}>
                {formatTimestamp(event.timestamp)}
              </time>
              {event.actor && (
                <span className="bounty-timeline__actor">by {event.actor}</span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function BountyDetailPage({
  bounty,
  loading,
  onBack,
  owner,
  avatarUrl,
  statusCopy,
  actionCopy,
  renderActionButton,
  formatTimestamp,
}: Props) {

  return (
    <div className="page-shell">
      <div className="glow glow-left" />
      <div className="glow glow-right" />

      <section className="panel bounty-detail">
        <div className="panel-header">
          <div>
            <span className="panel-kicker">Bounty</span>
            <h2>{bounty ? bounty.title : "Bounty"}</h2>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={onBack}
            disabled={loading}
          >
            Back
          </button>
        </div>

        {loading && !bounty ? (
          <div className="empty-state">Loading bounty...</div>
        ) : !bounty ? (
          <div className="empty-state">Bounty not found.</div>
        ) : (
          <div className="bounty-detail__content">
            <div className="bounty-detail__hero">
              {avatarUrl && (
                <img
                  className="repo-avatar"
                  src={avatarUrl}
                  alt={owner}
                  loading="lazy"
                />
              )}
              <div>
                <span
                  className={`status-pill status-pill--${bounty.status}`}
                  title={statusCopy[bounty.status].description}
                >
                  {statusCopy[bounty.status].label}
                </span>
                <p className="bounty-summary">{bounty.summary}</p>
              </div>
              <div className="amount-chip">
                {bounty.amount} {bounty.tokenSymbol}
                {bounty.tokenSymbol === "XLM" && (
                  <UsdAmount amount={bounty.amount} />
                )}
              </div>
            </div>

            <div className="meta-grid meta-grid--detail">
              <div>
                <span className="meta-label">Bounty ID</span>
                <strong className="copy-row">
                  {bounty.id}
                  <CopyButton text={bounty.id} label="bounty ID" />
                </strong>
              </div>
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
                <span className="meta-label">Created</span>
                <strong>{formatTimestamp(bounty.createdAt)}</strong>
              </div>
              <div>
                <span className="meta-label">Deadline</span>
                <strong>{formatTimestamp(bounty.deadlineAt)}</strong>
              </div>
              <div>
                <span className="meta-label">Maintainer</span>
                <strong className="copy-row">
                  {bounty.maintainer}
                  <CopyButton text={bounty.maintainer} label="maintainer wallet address" />
                </strong>
              </div>
              <div>
                <span className="meta-label">Contributor</span>
                <strong className="copy-row">
                  {bounty.contributor ?? "Open"}
                  {bounty.contributor && (
                    <CopyButton text={bounty.contributor} label="contributor address" />
                  )}
                </strong>
              </div>
              {bounty.reservedAt && (
                <div>
                  <span className="meta-label">Reserved</span>
                  <strong>{formatTimestamp(bounty.reservedAt)}</strong>
                </div>
              )}
              {bounty.submittedAt && (
                <div>
                  <span className="meta-label">Submitted</span>
                  <strong>{formatTimestamp(bounty.submittedAt)}</strong>
                </div>
              )}
              {bounty.releasedAt && (
                <div>
                  <span className="meta-label">Released</span>
                  <strong>{formatTimestamp(bounty.releasedAt)}</strong>
                </div>
              )}
              {bounty.refundedAt && (
                <div>
                  <span className="meta-label">Refunded</span>
                  <strong>{formatTimestamp(bounty.refundedAt)}</strong>
                </div>
              )}
              {bounty.releasedTxHash && (
                <div>
                  <span className="meta-label">Release tx</span>
                  <strong className="copy-row">
                    {bounty.releasedTxHash}
                    <CopyButton text={bounty.releasedTxHash} label="release transaction hash" />
                  </strong>
                </div>
              )}
              {bounty.refundedTxHash && (
                <div>
                  <span className="meta-label">Refund tx</span>
                  <strong className="copy-row">
                    {bounty.refundedTxHash}
                    <CopyButton text={bounty.refundedTxHash} label="refund transaction hash" />
                  </strong>
                </div>
              )}
            </div>

            {bounty.labels.length > 0 && (
              <div className="chip-row chip-row--spaced">
                {bounty.labels.map((label) => (
                  <span className="chip" key={label.name}>
  {label.name}
</span>
                ))}
              </div>
            )}

            {bounty.submissionUrl && (
              <a
                className="submission-link"
                href={bounty.submissionUrl}
                target="_blank"
                rel="noreferrer"
              >
                Review submission <ArrowUpRight size={16} />
              </a>
            )}

            {bounty.notes && (
              <p className="status-helper">
                <strong>Notes:</strong> {bounty.notes}
              </p>
            )}

            <p className="status-helper">
              <strong>{statusCopy[bounty.status].label}:</strong>{" "}
              {statusCopy[bounty.status].description}
            </p>

            <div className="action-row action-row--detail">
              {(actionCopy[bounty.status] ?? []).map((action) =>
                renderActionButton(bounty, action),
              )}
            </div>

            {bounty.events && bounty.events.length > 0 && (
              <BountyTimeline events={bounty.events} formatTimestamp={formatTimestamp} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
