import { ReactNode, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Share2,
  Printer,
  Star,
} from 'lucide-react';
import { Bounty, BountyEvent, BountyStatus } from './types';
import BountyCountdown from './BountyCountdown';
import UsdAmount from './UsdAmount';
import { updateSocialMetaTags } from './metaTags';
import CopyIcon from './CopyIcons';
import { extendDeadline } from './api';
import { findSimilarBounties, type BountyRecommendation } from './recommendations';
import { useI18n } from './i18n/I18nContext';
import DisputePanel from './DisputePanel';

type BountyAction = 'reserve' | 'submit' | 'release' | 'refund';

const DEFAULT_STATUS_COPY: Record<BountyStatus, { label: string; description: string }> = {
  open: { label: 'Open', description: 'Available for work' },
  reserved: { label: 'Reserved', description: 'Claimed by contributor' },
  submitted: { label: 'Submitted', description: 'Work submitted for review' },
  released: { label: 'Released', description: 'Payment disbursed' },
  refunded: { label: 'Refunded', description: 'Funds returned to creator' },
  disputed: { label: 'Disputed', description: 'Under arbitration' },
};

const DEFAULT_ACTION_COPY: Record<
  BountyStatus,
  Array<{ action: BountyAction; label: string; title: string }>
> = {
  open: [{ action: 'reserve', label: 'Reserve', title: 'Reserve this bounty' }],
  reserved: [{ action: 'submit', label: 'Submit Work', title: 'Submit work for review' }],
  submitted: [{ action: 'release', label: 'Release Payment', title: 'Release bounty funds' }],
  released: [],
  refunded: [],
  disputed: [],
};

type Props = {
  bounty: Bounty | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onBack?: () => void;
  owner?: string;
  avatarUrl?: string;
  statusCopy?: Record<BountyStatus, { label: string; description: string }>;
  actionCopy?: Record<BountyStatus, Array<{ action: BountyAction; label: string; title: string }>>;
  renderActionButton?: (
    bounty: Bounty,
    action: { action: BountyAction; label: string; title: string }
  ) => ReactNode;
  formatTimestamp?: (value?: number) => string;
  bounties?: Bounty[];
  onBountyUpdated?: (bounty: Bounty) => void;
};

function useBountyStatusAnnouncement(
  bounty: Bounty | null,
  statusCopy: Record<BountyStatus, { label: string; description: string }>,
  clearAfterMs = 3000
) {
  const previousStatusRef = useRef<{ id: string; status: BountyStatus } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!bounty) {
      previousStatusRef.current = null;
      setAnnouncement('');
      return;
    }

    const previous = previousStatusRef.current;
    if (previous?.id === bounty.id && previous.status !== bounty.status) {
      setAnnouncement(
        `Bounty #${bounty.issueNumber} status changed to ${statusCopy[bounty.status].label}`
      );
    }

    previousStatusRef.current = { id: bounty.id, status: bounty.status };
  }, [bounty, statusCopy]);

  useEffect(() => {
    if (!announcement) return;

    const timeoutId = window.setTimeout(() => {
      setAnnouncement('');
    }, clearAfterMs);

    return () => window.clearTimeout(timeoutId);
  }, [announcement, clearAfterMs]);

  return announcement;
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Bounty created',
  reserved: 'Bounty reserved',
  submitted: 'Work submitted',
  released: 'Payment released',
  refunded: 'Bounty refunded',
  expired: 'Bounty expired',
  disputed: 'Dispute raised',
  pr_merged: 'Pull request merged',
};

export function getAccessibleBountyDetailLabel(bounty: Bounty): string {
  return `Bounty #${bounty.issueNumber}: ${bounty.title}, reward ${bounty.amount} ${bounty.tokenSymbol}, status ${bounty.status}`;
}

function BountyTimeline({
  events,
  formatTimestamp,
}: {
  events: BountyEvent[];
  formatTimestamp: (v?: number) => string;
}) {
  if (!events || events.length === 0) return null;

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className="bounty-timeline">
      <h3 className="bounty-timeline__title">
        <Clock size={16} aria-hidden="true" />
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
              <time
                className="bounty-timeline__time"
                dateTime={new Date(event.timestamp * 1000).toISOString()}
              >
                {formatTimestamp(event.timestamp)}
              </time>
              {event.actor && <span className="bounty-timeline__actor">by {event.actor}</span>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function BountyDetailPage({
  bounty,
  loading = false,
  error = null,
  onRetry,
  onBack = () => {},
  owner = '',
  avatarUrl = '',
  statusCopy = DEFAULT_STATUS_COPY,
  actionCopy = DEFAULT_ACTION_COPY,
  renderActionButton = () => null,
  formatTimestamp = (v) => (v ? new Date(v * 1000).toLocaleDateString() : ''),
  bounties = [],
  onBountyUpdated,
}: Props) {
  const { t } = useI18n();
  const statusAnnouncement = useBountyStatusAnnouncement(bounty, statusCopy);
  const [copied, setCopied] = useState(false);

  const similarBounties = useMemo(() => {
    if (!bounty || !bounties || bounties.length === 0) return [];
    return findSimilarBounties(bounty, bounties, 3);
  }, [bounty, bounties]);

  useEffect(() => {
    updateSocialMetaTags(bounty);
    return () => {
      updateSocialMetaTags(null);
    };
  }, [bounty]);

  function handlePrint() {
    window.print();
  }

  function handleShare() {
    if (!bounty) return;
    const permalink = `${window.location.origin}/bounties/${encodeURIComponent(bounty.id)}`;
    navigator.clipboard
      .writeText(permalink)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => {
        console.error('Failed to copy URL:', err);
        // Fallback: show the URL in a prompt so the user can manually copy it
        window.prompt('Copy the bounty URL manually:', permalink);
      });
  }

  return (
    <div className="page-shell">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusAnnouncement}
      </div>
      <div className="glow glow-left" />
      <div className="glow glow-right" />

      <section
        className="panel bounty-detail"
        aria-label={bounty ? getAccessibleBountyDetailLabel(bounty) : 'Bounty details'}
      >
        <div className="panel-header">
          <div>
            <span className="panel-kicker">{t('bounty.kicker', 'Bounty')}</span>
            <h2>{bounty ? bounty.title : t('bounty.defaultTitle', 'Bounty')}</h2>
          </div>
          <div className="panel-header__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleShare}
              disabled={loading || !bounty}
              aria-label="Share bounty"
              title="Copy bounty URL to clipboard"
            >
              {copied ? (
                <>
                  <Check size={16} aria-hidden="true" /> {t('common.copied', 'Copied!')}
                </>
              ) : (
                <>
                  <Share2 size={16} aria-hidden="true" /> {t('common.share', 'Share')}
                </>
              )}
            </button>
            <button
              type="button"
              className="secondary-button print-button"
              onClick={handlePrint}
              disabled={loading || !bounty}
              aria-label="Print or Export PDF"
              title="Print or Export PDF"
            >
              <Printer size={16} aria-hidden="true" />
              {t('common.print', 'Print / Export PDF')}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={onBack}
              disabled={loading}
              aria-label="Go back to bounties list"
            >
              {t('common.back', 'Back')}
            </button>
          </div>
        </div>

        {loading && !bounty ? (
          <div
            className="empty-state bounty-detail--loading"
            role="status"
            aria-busy="true"
            data-testid="bounty-detail-loading"
          >
            <div className="loading-spinner" aria-hidden="true" />
            <p>{t('bounty.loading', 'Loading bounty...')}</p>
          </div>
        ) : error ? (
          <div
            className="error-state bounty-detail--error"
            role="alert"
            data-testid="bounty-detail-error"
          >
            <AlertTriangle size={28} aria-hidden="true" />
            <p className="bounty-detail__error-message">{error}</p>
            {onRetry && (
              <button
                type="button"
                className="secondary-button bounty-detail__retry-btn"
                onClick={onRetry}
                aria-label="Retry loading bounty"
              >
                {t('common.retry', 'Retry')}
              </button>
            )}
          </div>
        ) : !bounty ? (
          <div
            className="empty-state bounty-detail--empty"
            role="status"
            data-testid="bounty-detail-empty"
          >
            <p>{t('bounty.notFound', 'Bounty not found.')}</p>
          </div>
        ) : (
          <div className="bounty-detail__content">
            <div className="bounty-detail__hero">
              {avatarUrl && (
                <img
                  className="repo-avatar"
                  src={avatarUrl}
                  alt={`${owner} repository avatar`}
                  loading="lazy"
                />
              )}
              <div>
                <div
                  className="bounty-status-pills"
                  style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    marginBottom: '8px',
                  }}
                >
                  <span
                    className={`status-pill status-pill--${bounty.status}`}
                    title={statusCopy[bounty.status]?.description}
                    data-testid="bounty-application-status"
                  >
                    {statusCopy[bounty.status]?.label ?? bounty.status}
                  </span>
                  {(bounty.escrowStatus || bounty.onChainEscrowStatus) && (
                    <span
                      className={`status-pill status-pill--escrow status-pill--${(bounty.escrowStatus || bounty.onChainEscrowStatus)?.toLowerCase()}`}
                      data-testid="bounty-escrow-status"
                      title="On-chain Soroban escrow status"
                      style={{ border: '1px solid currentColor' }}
                    >
                      Escrow:{' '}
                      {(
                        (bounty.escrowStatus || bounty.onChainEscrowStatus) as string
                      ).toUpperCase()}
                    </span>
                  )}
                  {bounty.prMerged && (
                    <span
                      className="status-pill status-pill--released"
                      data-testid="bounty-pr-merged-status"
                      title="Pull Request merged on GitHub"
                    >
                      PR Merged
                    </span>
                  )}
                </div>
                <p className="bounty-summary">{bounty.summary}</p>
              </div>
              <div className="amount-chip">
                {bounty.amount} {bounty.tokenSymbol}
                {(bounty.tokenSymbol === 'XLM' || bounty.tokenSymbol === 'USDC') && (
                  <UsdAmount amount={bounty.amount} tokenSymbol={bounty.tokenSymbol} />
                )}
              </div>
            </div>

            {/* Status Mismatch Warning Banner (Issue #1452) */}
            {(() => {
              const escrow = bounty.escrowStatus || bounty.onChainEscrowStatus;
              if (!escrow) return null;
              const isMismatch = escrow.toLowerCase() !== bounty.status.toLowerCase();
              if (!isMismatch) return null;
              return (
                <div
                  className="error-banner status-mismatch-banner"
                  role="alert"
                  data-testid="bounty-status-mismatch-alert"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    margin: '16px 0',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid #ef4444',
                    borderRadius: '8px',
                    color: '#f87171',
                  }}
                >
                  <AlertTriangle size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: '2px' }}>
                      Status Mismatch Detected
                    </strong>
                    <span>
                      Application status is{' '}
                      <strong>{statusCopy[bounty.status]?.label ?? bounty.status}</strong>, but
                      on-chain escrow status is <strong>{escrow.toUpperCase()}</strong>. Contract
                      state and backend state disagree.
                    </span>
                  </div>
                </div>
              );
            })()}

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
                    aria-label={`View issue #${bounty.issueNumber} on GitHub`}
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
                <strong>
                  {formatTimestamp(bounty.deadlineAt)}{' '}
                  <BountyCountdown deadlineAt={bounty.deadlineAt} status={bounty.status} />
                </strong>
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
                  {bounty.contributor ?? 'Open'}
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
              {bounty.prMergedAt && (
                <div>
                  <span className="meta-label">PR Merged</span>
                  <strong>{formatTimestamp(bounty.prMergedAt)}</strong>
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
                    <CopyIcon text={bounty.releasedTxHash} label="release transaction hash" />
                  </strong>
                </div>
              )}
              {bounty.refundedTxHash && (
                <div>
                  <span className="meta-label">Refund tx</span>
                  <strong className="copy-row">
                    {bounty.refundedTxHash}
                    <CopyIcon text={bounty.refundedTxHash} label="refund transaction hash" />
                  </strong>
                </div>
              )}
              {(bounty.escrowStatus || bounty.onChainEscrowStatus) && (
                <div>
                  <span className="meta-label">Escrow state</span>
                  <strong data-testid="meta-escrow-status">
                    {((bounty.escrowStatus || bounty.onChainEscrowStatus) as string).toUpperCase()}
                  </strong>
                </div>
              )}
            </div>

            {bounty.labels.length > 0 && (
              <div className="chip-row chip-row--spaced">
                {bounty.labels.map((label: any) => (
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
                aria-label="Review submission work on GitHub"
              >
                Review submission <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            )}

            {bounty.notes && (
              <p className="status-helper">
                <strong>Notes:</strong> {bounty.notes}
              </p>
            )}

            <p className="status-helper">
              <strong>{statusCopy[bounty.status].label}:</strong>{' '}
              {statusCopy[bounty.status].description}
            </p>

            <div className="action-row action-row--detail">
              {(actionCopy[bounty.status] ?? []).map((action) =>
                renderActionButton(bounty, action)
              )}
            </div>

            {!['released', 'refunded'].includes(bounty.status) && (
              <ExtendDeadlineControl bounty={bounty} formatTimestamp={formatTimestamp} />
            )}

            <DisputePanel
              bounty={bounty}
              onBountyUpdated={onBountyUpdated}
              formatTimestamp={formatTimestamp}
            />

            {bounty.events && bounty.events.length > 0 && (
              <BountyTimeline events={bounty.events} formatTimestamp={formatTimestamp} />
            )}
          </div>
        )}

        {similarBounties.length > 0 && (
          <section className="panel more-like-this">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Similar bounties</span>
                <h2>More like this</h2>
              </div>
              <Star size={18} aria-hidden="true" />
            </div>
            <div className="board-list">
              {similarBounties.map((rec) => (
                <article key={rec.bounty.id} className="bounty-card bounty-card--recommended">
                  <div className="bounty-card__top">
                    <div>
                      <span className={`status-pill status-pill--${rec.bounty.status}`}>
                        {statusCopy[rec.bounty.status].label}
                      </span>
                      <h3>{rec.bounty.title}</h3>
                    </div>
                    <div className="amount-chip">
                      {rec.bounty.amount} {rec.bounty.tokenSymbol}
                    </div>
                  </div>
                  <p className="bounty-summary">{rec.bounty.summary}</p>
                  <div className="recommendation-score">
                    <Star size={14} aria-hidden="true" />
                    <span>{Math.round(rec.score * 100)}% match</span>
                  </div>
                  <div className="recommendation-reasons">
                    {rec.reasons.slice(0, 2).map((reason) => (
                      <span key={reason} className="reason-tag">
                        {reason}
                      </span>
                    ))}
                  </div>
                  <div className="recommendation-footer">
                    <a
                      className="secondary-link"
                      href={`https://github.com/${rec.bounty.repo}/issues/${rec.bounty.issueNumber}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`View similar issue #${rec.bounty.issueNumber} for ${rec.bounty.title}`}
                    >
                      View issue <ArrowUpRight size={16} aria-hidden="true" />
                    </a>
                  </div>
                </article>
              ))}
            </div>
            <p className="recommendations-disclaimer">
              Suggestions based on repo similarity, reward range, and label overlap.
            </p>
          </section>
        )}
      </section>
    </div>
  );
}

/**
 * Maintainer-only control to extend a bounty's deadline. Renders a date/time
 * picker and submits the new deadline to the backend. The picker is bounded so
 * a maintainer can only pick a moment strictly after the current deadline.
 */
export function ExtendDeadlineControl({
  bounty,
  formatTimestamp,
}: {
  bounty: Bounty;
  formatTimestamp: (value?: number) => string;
}) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // datetime-local needs a "YYYY-MM-DDTHH:mm" string in local time. The minimum
  // selectable value is one minute after the current deadline.
  const minLocal = toDatetimeLocal((bounty.deadlineAt + 60) * 1000);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!value) {
      setError('Pick a new deadline date and time.');
      return;
    }

    const newDeadline = Math.floor(new Date(value).getTime() / 1000);
    if (Number.isNaN(newDeadline)) {
      setError('That is not a valid date.');
      return;
    }
    if (newDeadline <= bounty.deadlineAt) {
      setError('New deadline must be later than the current deadline.');
      return;
    }
    if (newDeadline <= Math.floor(Date.now() / 1000)) {
      setError('New deadline must be in the future.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await extendDeadline(bounty.id, bounty.maintainer, newDeadline);
      setSuccess(`Deadline extended to ${formatTimestamp(updated.deadlineAt)}.`);
      setValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extend the deadline.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="extend-deadline" onSubmit={handleSubmit}>
      <label htmlFor="extend-deadline-input" className="meta-label">
        Extend deadline
      </label>
      <div className="extend-deadline__row">
        <input
          id="extend-deadline-input"
          type="datetime-local"
          value={value}
          min={minLocal}
          onChange={(e) => setValue(e.target.value)}
          disabled={submitting}
          aria-describedby={
            error ? 'extend-deadline-error' : success ? 'extend-deadline-success' : undefined
          }
        />
        <button type="submit" className="secondary-button" disabled={submitting || !value}>
          {submitting ? 'Extending…' : 'Extend Deadline'}
        </button>
      </div>
      {error && (
        <small id="extend-deadline-error" className="field-error" role="alert">
          {error}
        </small>
      )}
      {success && (
        <small id="extend-deadline-success" className="field-hint" role="status">
          {success}
        </small>
      )}
    </form>
  );
}

/** Convert a millisecond epoch to a `datetime-local`-compatible local string. */
function toDatetimeLocal(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
