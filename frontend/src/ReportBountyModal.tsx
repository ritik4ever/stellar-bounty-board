import { FormEvent, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Bounty } from "./types";

const REPORT_REASONS = [
  { value: "spam", label: "Spam or duplicate" },
  { value: "incorrect-amount", label: "Incorrect bounty amount" },
  { value: "misleading", label: "Misleading description" },
  { value: "no-show", label: "Maintainer not responding to submissions" },
  { value: "other", label: "Other" },
] as const;

type ReportReason = (typeof REPORT_REASONS)[number]["value"];

interface Props {
  bounty: Bounty;
  submitting: boolean;
  error: string | null;
  onSubmit: (reason: ReportReason, details: string) => void;
  onClose: () => void;
}

export default function ReportBountyModal({
  bounty,
  submitting,
  error,
  onSubmit,
  onClose,
}: Props) {
  const [reason, setReason] = useState<ReportReason | "">("");
  const [details, setDetails] = useState("");
  const [touched, setTouched] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof dialogRef.current?.showModal === "function") {
      dialogRef.current.showModal();
    }
    firstInputRef.current?.focus();
  }, []);

  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  function handleCancel(e: React.SyntheticEvent) {
    e.preventDefault();
    onClose();
  }

  function handleDialogKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)',
    );
    const focusableArray = Array.from(focusable);

    if (focusableArray.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }

    const currentIndex = focusableArray.findIndex(
      (el) => el === document.activeElement,
    );
    const nextIndex = e.shiftKey
      ? currentIndex <= 0
        ? focusableArray.length - 1
        : currentIndex - 1
      : currentIndex === -1 || currentIndex === focusableArray.length - 1
        ? 0
        : currentIndex + 1;

    e.preventDefault();
    focusableArray[nextIndex].focus();
  }

  const isValid = reason !== "";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!isValid) return;
    onSubmit(reason as ReportReason, details.trim());
  }

  return (
    <dialog
      ref={dialogRef}
      className="report-modal"
      onClick={handleDialogClick}
      onCancel={handleCancel}
      onKeyDown={handleDialogKeyDown}
      aria-labelledby="report-modal-title"
      aria-modal="true"
    >
      <div className="report-modal__inner">
        <div className="report-modal__header">
          <div>
            <span className="panel-kicker">Report bounty</span>
            <h2 id="report-modal-title">Report this bounty</h2>
          </div>
        </div>

        <p className="report-modal__intro">
          Flag <strong>{bounty.title}</strong> for review by the platform
          maintainers. Please provide a reason so we can follow up.
        </p>

        {error && <div className="error-banner" role="alert">{error}</div>}

        <form className="report-modal__form" onSubmit={handleSubmit} noValidate>
          {/* Reason selector */}
          <label>
            Reason for reporting *
            <div className="report-modal__options">
              {REPORT_REASONS.map((r) => (
                <label
                  key={r.value}
                  className={`report-modal__option ${
                    reason === r.value ? "report-modal__option--selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    disabled={submitting}
                    ref={r.value === REPORT_REASONS[0].value ? firstInputRef : undefined}
                  />
                  {r.label}
                </label>
              ))}
            </div>
            {touched && !isValid && (
              <small className="field-error" role="alert">
                Select a reason for reporting this bounty.
              </small>
            )}
          </label>

          {/* Details */}
          <label>
            Additional details{" "}
            <small className="field-hint">(optional)</small>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Provide any additional context that helps the review..."
              rows={3}
              disabled={submitting}
            />
          </label>

          <div className="report-modal__actions">
            <button
              type="button"
              className="ghost-button"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={submitting || !isValid}
              aria-disabled={submitting || !isValid}
            >
              {submitting ? "Submitting…" : "Submit report"}
            </button>
          </div>
        </form>

        <button
          type="button"
          className="modal-close-btn"
          aria-label="Close"
          onClick={onClose}
          disabled={submitting}
        >
          <X size={18} />
        </button>
      </div>
    </dialog>
  );
}