
import { ReactNode, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Clock, Printer } from "lucide-react";

import CopyIcon from "./CopyIcons";
import UsdAmount from "./UsdAmount";
import type { Bounty, BountyEvent, BountyStatus } from "./types";
import { updateSocialMetaTags } from "./metaTags";

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

function useBountyStatusAnnouncement(
  bounty: Bounty | null,
  statusCopy: Record<BountyStatus, { label: string; description: string }>,
  clearAfterMs = 3000,
) {
  const previousStatusRef = useRef<{ id: string; status: BountyStatus } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!bounty) {
      previousStatusRef.current = null;
      setAnnouncement("");
      return;
    }

    const previous = previousStatusRef.current;
    if (previous?.id === bounty.id && previous.status !== bounty.status) {
      setAnnouncement(
        `Bounty #${bounty.issueNumber} status changed to ${statusCopy[bounty.status].label}`,
      );
    }

    previousStatusRef.current = { id: bounty.id, status: bounty.status };
  }, [bounty, statusCopy]);

  useEffect(() => {
    if (!announcement) return;

    const timeoutId = window.setTimeout(() => {
      setAnnouncement("");
    }, clearAfterMs);

    return () => window.clearTimeout(timeoutId);
  }, [announcement, clearAfterMs]);

  return announcement;
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
  const statusAnnouncement = useBountyStatusAnnouncement(bounty, statusCopy);

  // Update social meta tags when bounty data changes
  useEffect(() => {
    updateSocialMetaTags(bounty);

    // Cleanup: reset meta tags when component unmounts
    return () => {
      updateSocialMetaTags(null);
    };
  }, [bounty]);

  // Issue #373: inject canonical <link> so search engines index the stable URL
  useEffect(() => {
    if (!bounty) return;
    let canonical = document.querySelector<HTMLLinkElement>("link[rel='canonical']");
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = `${window.location.origin}/bounties/${bounty.id}`;
    return () => {
      if (canonical) canonical.href = "";
    };
  }, [bounty]);

  function handlePrint() {
    window.print();
  }

  return (
    <div className="page-shell">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusAnnouncement}
      </div>
      <div className="glow glow-left" />
      <div className="glow glow-right" />

      <section className="panel bounty-detail">
        <div className="panel-header">
          <div>
            <span className="panel-kicker">Bounty</span>
            <h2>{bounty ? bounty.title : "Bounty"}</h2>
          </div>
          <div className="panel-header__actions">
            <button
              type="button"
              className="secondary-button print-button"
              onClick={handlePrint}
              disabled={loading || !bounty}
              aria-label="Print / Export PDF"
              title="Print / Export PDF"
            >
              <Printer size={16} />
              Print / Export PDF
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={onBack}
              disabled={loading}
            >
              Back
            </button>
          </div>
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
                  <CopyIcon text={bounty.id} label="bounty ID" />
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
                  <CopyIcon text={bounty.maintainer} label="maintainer wallet address" />
                </strong>
              </div>
              <div>
                <span className="meta-label">Contributor</span>
                <strong className="copy-row">
                  {bounty.contributor ?? "Open"}
                  {bounty.contributor && (
                    <CopyIcon text={bounty.contributor} label="contributor address" />
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
                    {/* Issue #382: clickable Stellar Expert deep link */}
                    <a
                      className="inline-link"
                      href={`https://stellar.expert/explorer/testnet/tx/${bounty.releasedTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      title="View on Stellar Expert"
                    >
                      {bounty.releasedTxHash.slice(0, 8)}…{bounty.releasedTxHash.slice(-6)}
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </a>
                    <CopyIcon text={bounty.releasedTxHash} label="release transaction hash" />
                  </strong>
                </div>
              )}
              {bounty.refundedTxHash && (
                <div>
                  <span className="meta-label">Refund tx</span>
                  <strong className="copy-row">
                    {/* Issue #382: clickable Stellar Expert deep link */}
                    <a
                      className="inline-link"
                      href={`https://stellar.expert/explorer/testnet/tx/${bounty.refundedTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      title="View on Stellar Expert"
                    >
                      {bounty.refundedTxHash.slice(0, 8)}…{bounty.refundedTxHash.slice(-6)}
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </a>
                    <CopyIcon text={bounty.refundedTxHash} label="refund transaction hash" />
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
