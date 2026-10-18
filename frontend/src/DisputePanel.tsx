import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Scale, ShieldAlert, ArrowRight } from 'lucide-react';
import { Bounty } from './types';
import { disputeBounty, resolveDisputeBounty } from './api';

export interface DisputePanelProps {
  bounty: Bounty;
  onBountyUpdated?: (bounty: Bounty) => void;
  currentUserAddress?: string;
  configuredArbiterAddress?: string;
  formatTimestamp?: (timestamp?: number) => string;
}

export default function DisputePanel({
  bounty,
  onBountyUpdated,
  currentUserAddress = '',
  configuredArbiterAddress = '',
  formatTimestamp = (v) => (v ? new Date(v * 1000).toLocaleString() : ''),
}: DisputePanelProps) {
  const [isOpenFormVisible, setIsOpenFormVisible] = useState(false);
  const [reason, setReason] = useState('');
  const [arbiterAddress, setArbiterAddress] = useState(
    configuredArbiterAddress ||
      (typeof process !== 'undefined' && process.env?.VITE_ARBITER_ADDRESS
        ? process.env.VITE_ARBITER_ADDRESS
        : '')
  );
  const [txHash, setTxHash] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const isWithinWindow = bounty.deadlineAt ? nowSeconds <= bounty.deadlineAt : true;

  // We only show this panel if the bounty is in 'submitted' or 'disputed' state
  if (bounty.status !== 'submitted' && bounty.status !== 'disputed') {
    return null;
  }

  // Handle dispute creation by maintainer/contributor
  const handleRaiseDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError('Please provide a reason for the dispute.');
      return;
    }

    if (trimmedReason.length > 500) {
      setError('Dispute reason cannot exceed 500 characters.');
      return;
    }

    if (!isWithinWindow) {
      setError('Dispute window has expired. Disputes cannot be raised after the deadline.');
      return;
    }

    // Use contributor address on the bounty, fallback to current user
    const actorAddress = bounty.contributor || currentUserAddress || bounty.maintainer;
    if (!actorAddress) {
      setError('A valid contributor address is required to raise a dispute.');
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await disputeBounty(bounty.id, actorAddress, trimmedReason);
      setSuccessMessage('Dispute has been raised successfully and sent to arbitration.');
      setReason('');
      setIsOpenFormVisible(false);
      if (onBountyUpdated) {
        onBountyUpdated(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to raise dispute.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle dispute resolution by arbiter
  const handleResolveDispute = async (release: boolean) => {
    setError(null);
    setSuccessMessage(null);

    const activeArbiter = arbiterAddress.trim() || currentUserAddress.trim();
    if (!activeArbiter) {
      setError('Arbiter Stellar address is required to resolve this dispute.');
      return;
    }

    const cleanTxHash = txHash.trim() || undefined;
    if (cleanTxHash && !/^[0-9a-fA-F]{64}$/.test(cleanTxHash)) {
      setError('Transaction hash must be a valid 64-character hex string.');
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await resolveDisputeBounty(bounty.id, activeArbiter, release, cleanTxHash);
      setSuccessMessage(
        release
          ? 'Dispute resolved: Escrow funds released to contributor.'
          : 'Dispute resolved: Escrow funds refunded to maintainer.'
      );
      setTxHash('');
      if (onBountyUpdated) {
        onBountyUpdated(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve dispute.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      className="dispute-panel"
      data-testid="dispute-panel"
      aria-labelledby="dispute-panel-heading"
    >
      <div className="dispute-panel__header">
        <div className="dispute-panel__title-wrap">
          <Scale size={20} className="dispute-panel__icon" aria-hidden="true" />
          <h3 id="dispute-panel-heading" className="dispute-panel__title">
            Arbitration & Dispute Resolution
          </h3>
        </div>
        <span
          className={`status-pill status-pill--${bounty.status}`}
          data-testid="dispute-status-banner"
        >
          {bounty.status === 'disputed' ? 'Under Arbitration' : 'Review Window'}
        </span>
      </div>

      {error && (
        <div
          className="dispute-panel__alert dispute-panel__alert--error"
          role="alert"
          data-testid="dispute-error-alert"
        >
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div
          className="dispute-panel__alert dispute-panel__alert--success"
          role="status"
          data-testid="dispute-success-alert"
        >
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Case 1: Bounty is Submitted -> Maintainer / Reviewer can raise dispute within window */}
      {bounty.status === 'submitted' && (
        <div className="dispute-panel__submitted-view">
          <p className="dispute-panel__description">
            The contributor has submitted work for review. If deliverables are contested or require
            third-party arbitration, you can raise an on-chain dispute within the review window.
          </p>

          <div className="dispute-panel__window-info">
            <span className="meta-label">Review Window:</span>
            {isWithinWindow ? (
              <span className="dispute-panel__window-active">
                Active (Deadline: {formatTimestamp(bounty.deadlineAt)})
              </span>
            ) : (
              <span className="dispute-panel__window-expired">
                Expired ({formatTimestamp(bounty.deadlineAt)})
              </span>
            )}
          </div>

          {!isOpenFormVisible ? (
            <div className="dispute-panel__actions">
              <button
                type="button"
                className="secondary-button dispute-panel__raise-trigger"
                data-testid="raise-dispute-btn"
                onClick={() => setIsOpenFormVisible(true)}
                disabled={!isWithinWindow}
                title={
                  isWithinWindow
                    ? 'Raise an on-chain dispute for arbiter review'
                    : 'Dispute window has expired'
                }
              >
                <ShieldAlert size={16} aria-hidden="true" />
                Raise Dispute
              </button>
            </div>
          ) : (
            <form
              onSubmit={handleRaiseDispute}
              className="dispute-panel__form"
              data-testid="raise-dispute-form"
            >
              <div className="form-group">
                <label htmlFor="dispute-reason-input" className="meta-label">
                  Reason for Dispute <span className="required">*</span>
                </label>
                <textarea
                  id="dispute-reason-input"
                  data-testid="dispute-reason-input"
                  className="dispute-panel__textarea"
                  rows={4}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain why this submission is being disputed (e.g. incomplete deliverables, scope mismatch)..."
                  disabled={isSubmitting}
                  required
                />
                <small className="field-hint">{500 - reason.length} characters remaining</small>
              </div>

              <div className="dispute-panel__form-actions">
                <button
                  type="submit"
                  className="secondary-button dispute-panel__submit-btn"
                  data-testid="submit-dispute-btn"
                  disabled={isSubmitting || !reason.trim() || !isWithinWindow}
                >
                  {isSubmitting ? 'Raising Dispute…' : 'Submit Dispute to Arbiter'}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setIsOpenFormVisible(false);
                    setError(null);
                  }}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Case 2: Bounty is Disputed -> Arbiter resolution view */}
      {bounty.status === 'disputed' && (
        <div className="dispute-panel__arbiter-view" data-testid="arbiter-resolution-view">
          <div className="dispute-panel__disputed-summary">
            <div className="dispute-panel__row">
              <span className="meta-label">Disputed At:</span>
              <strong>{formatTimestamp(bounty.disputedAt)}</strong>
            </div>
            {bounty.disputeReason && (
              <div className="dispute-panel__row">
                <span className="meta-label">Dispute Reason:</span>
                <blockquote className="dispute-panel__quote">{bounty.disputeReason}</blockquote>
              </div>
            )}
            <div className="dispute-panel__row">
              <span className="meta-label">Contributor:</span>
              <code>{bounty.contributor || 'N/A'}</code>
            </div>
            <div className="dispute-panel__row">
              <span className="meta-label">Maintainer:</span>
              <code>{bounty.maintainer}</code>
            </div>
            <div className="dispute-panel__row">
              <span className="meta-label">Escrow Amount:</span>
              <strong>
                {bounty.amount} {bounty.tokenSymbol}
              </strong>
            </div>
          </div>

          <div className="dispute-panel__resolution-box">
            <h4 className="dispute-panel__subheading">Arbiter Resolution Actions</h4>
            <p className="dispute-panel__subtext">
              As an authorized arbiter, evaluate the submission deliverables against the bounty
              criteria and choose a resolution below.
            </p>

            <div className="form-group">
              <label htmlFor="arbiter-address-input" className="meta-label">
                Arbiter Public Key <span className="required">*</span>
              </label>
              <input
                id="arbiter-address-input"
                data-testid="arbiter-address-input"
                type="text"
                className="dispute-panel__input"
                placeholder="G..."
                value={arbiterAddress}
                onChange={(e) => setArbiterAddress(e.target.value)}
                disabled={isSubmitting}
              />
              <small className="field-hint">
                Must match the on-chain configured arbiter address for the escrow contract.
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="tx-hash-input" className="meta-label">
                On-Chain Transaction Hash (Optional)
              </label>
              <input
                id="tx-hash-input"
                data-testid="tx-hash-input"
                type="text"
                className="dispute-panel__input"
                placeholder="64-character hex transaction hash"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="dispute-panel__resolution-buttons">
              <button
                type="button"
                className="secondary-button dispute-panel__resolve-release"
                data-testid="resolve-release-btn"
                onClick={() => handleResolveDispute(true)}
                disabled={isSubmitting || !arbiterAddress.trim()}
                title="Release escrowed funds to contributor"
              >
                Release to Contributor <ArrowRight size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ghost-button dispute-panel__resolve-refund"
                data-testid="resolve-refund-btn"
                onClick={() => handleResolveDispute(false)}
                disabled={isSubmitting || !arbiterAddress.trim()}
                title="Refund escrowed funds back to maintainer"
              >
                Refund to Maintainer
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
