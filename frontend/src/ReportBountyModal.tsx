import { useEffect, useRef, useState } from 'react';
import { Check, Flag, X } from 'lucide-react';
import { reportBounty } from './api';

const MAX_REASON_LENGTH = 500;

/**
 * Bounties already reported in this browser session. Kept at module scope so
 * the throttle survives the modal being opened/closed, satisfying the
 * client-side rate-limit requirement (issue #844): a user can only report a
 * given bounty once per session, and an in-flight submit is double-guarded.
 */
const reportedBountyIds = new Set<string>();

interface ReportBountyModalProps {
  bountyId: string;
  onClose: () => void;
}

/**
 * Modal that lets any visitor flag a bounty with a short reason. Submits to
 * POST /api/bounties/:id/report and shows a confirmation on success. Repeated
 * reports for the same bounty in the same session are throttled client-side.
 */
export default function ReportBountyModal({ bountyId, onClose }: ReportBountyModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const alreadyReported = reportedBountyIds.has(bountyId);

  useEffect(() => {
    dialogRef.current?.showModal();
    textareaRef.current?.focus();
  }, []);

  // Escape / backdrop click closes the modal unless a request is in flight.
  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current && !submitting) onClose();
  }

  function handleCancel(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!submitting) onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || alreadyReported) return;

    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Please enter a reason so the report can be reviewed.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await reportBounty(bountyId, trimmed);
      reportedBountyIds.add(bountyId);
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to submit the report. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="report-bounty-modal"
      onClick={handleDialogClick}
      onCancel={handleCancel}
      aria-labelledby="report-bounty-modal-title"
    >
      {submitted ? (
        <div className="report-bounty-modal__body" role="status">
          <Check size={20} aria-hidden="true" />
          <h2 id="report-bounty-modal-title">Report submitted</h2>
          <p>Thanks for helping keep the board safe. The maintainers will review this bounty.</p>
          <div className="report-bounty-modal__actions">
            <button type="button" className="secondary-button" onClick={onClose} autoFocus>
              Close
            </button>
          </div>
        </div>
      ) : alreadyReported ? (
        <div className="report-bounty-modal__body" role="status">
          <Flag size={20} aria-hidden="true" />
          <h2 id="report-bounty-modal-title">Already reported</h2>
          <p>
            You've already reported this bounty in this session. Thanks for flagging it — the
            maintainers will review it.
          </p>
          <div className="report-bounty-modal__actions">
            <button type="button" className="secondary-button" onClick={onClose} autoFocus>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form className="report-bounty-modal__body" onSubmit={handleSubmit}>
          <div className="report-bounty-modal__heading">
            <h2 id="report-bounty-modal-title">Report this bounty</h2>
            <button
              type="button"
              className="report-bounty-modal__close"
              onClick={() => !submitting && onClose()}
              aria-label="Close report dialog"
              disabled={submitting}
            >
              <X size={16} />
            </button>
          </div>
          <p className="report-bounty-modal__intro">
            Flag this bounty if it looks fraudulent, misleading, or out of scope. Reports are
            reviewed by maintainers.
          </p>
          <label htmlFor="report-reason-input" className="meta-label">
            Reason
          </label>
          <textarea
            id="report-reason-input"
            ref={textareaRef}
            value={reason}
            maxLength={MAX_REASON_LENGTH}
            rows={4}
            placeholder="Why are you reporting this bounty?"
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
          />
          <div className="report-bounty-modal__meta">
            <span className="report-bounty-modal__count">
              {reason.length}/{MAX_REASON_LENGTH}
            </span>
            {error && (
              <small className="field-error" role="alert">
                {error}
              </small>
            )}
          </div>
          <div className="report-bounty-modal__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => !submitting && onClose()}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={submitting || reason.trim().length === 0}
            >
              {submitting ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
