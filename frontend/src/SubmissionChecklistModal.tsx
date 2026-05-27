import { FormEvent, useEffect, useRef, useState } from "react";
import { CheckSquare, Square, X } from "lucide-react";
import type { Bounty } from "./types";

export interface SubmissionFormData {
  contributor: string;
  prLink: string;
  issueLinked: boolean;
  descriptionExplainsChanges: boolean;
  ciChecksPass: boolean;
  notes: string;
}

interface Props {
  bounty: Bounty;
  initialData?: Partial<SubmissionFormData>;
  submitting: boolean;
  error: string | null;
  onSubmit: (data: SubmissionFormData) => void;
  onClose: () => void;
}

const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z0-9]{55}$/;

function validateUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "URL must start with http:// or https://";
    }
    return null;
  } catch {
    return "Enter a valid URL (e.g. https://github.com/owner/repo/pull/1)";
  }
}

export default function SubmissionChecklistModal({
  bounty,
  initialData,
  submitting,
  error,
  onSubmit,
  onClose,
}: Props) {
  const [contributor, setContributor] = useState(initialData?.contributor ?? bounty.contributor ?? "");
  const [prLink, setPrLink] = useState(initialData?.prLink ?? "");
  const [issueLinked, setIssueLinked] = useState(initialData?.issueLinked ?? false);
  const [descriptionExplainsChanges, setDescriptionExplainsChanges] = useState(
    initialData?.descriptionExplainsChanges ?? false,
  );
  const [ciChecksPass, setCiChecksPass] = useState(initialData?.ciChecksPass ?? false);
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [touched, setTouched] = useState({ contributor: false, prLink: false });

  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    firstInputRef.current?.focus();
  }, []);

  // Close on backdrop click
  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  // Close on Escape
  function handleCancel(e: React.SyntheticEvent) {
    e.preventDefault();
    onClose();
  }

  const contributorError =
    touched.contributor && contributor.trim() && !STELLAR_PUBLIC_KEY_REGEX.test(contributor.trim())
      ? "Enter a Stellar public key (starts with 'G', 56 characters)"
      : touched.contributor && !contributor.trim()
        ? "Contributor address is required"
        : null;

  const prLinkError =
    touched.prLink && !prLink.trim()
      ? "PR or demo link is required"
      : touched.prLink && prLink.trim()
        ? validateUrl(prLink)
        : null;

  const isValid =
    STELLAR_PUBLIC_KEY_REGEX.test(contributor.trim()) &&
    prLink.trim() !== "" &&
    validateUrl(prLink) === null;
  const isChecklistComplete = issueLinked && descriptionExplainsChanges && ciChecksPass;
  const canSubmit = isValid && isChecklistComplete && !submitting;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ contributor: true, prLink: true });
    if (!canSubmit) return;
    onSubmit({
      contributor: contributor.trim(),
      prLink: prLink.trim(),
      issueLinked,
      descriptionExplainsChanges,
      ciChecksPass,
      notes: notes.trim(),
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className="submission-modal"
      onClick={handleDialogClick}
      onCancel={handleCancel}
      aria-labelledby="modal-title"
      aria-modal="true"
    >
      <div className="submission-modal__inner">
        <div className="submission-modal__header">
          <div>
            <span className="panel-kicker">Submission checklist</span>
            <h2 id="modal-title">Submit your work</h2>
          </div>
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

        <p className="submission-modal__intro">
          Review the checklist below before submitting{" "}
          <strong>{bounty.title}</strong>. Required fields are marked with *.
        </p>

        {error && <div className="error-banner" role="alert">{error}</div>}

        <form className="submission-modal__form" onSubmit={handleSubmit} noValidate>
          {/* Contributor address */}
          <label>
            Contributor Stellar address *
            <input
              ref={firstInputRef}
              type="text"
              value={contributor}
              onChange={(e) => setContributor(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, contributor: true }))}
              placeholder="G... (56 chars)"
              autoComplete="off"
              aria-invalid={Boolean(contributorError)}
              aria-describedby={contributorError ? "contributor-error" : undefined}
              disabled={submitting}
            />
            <small className="field-hint">Your Stellar public key (starts with 'G', 56 characters)</small>
            {contributorError && (
              <small className="field-error" id="contributor-error">{contributorError}</small>
            )}
          </label>

          {/* PR / demo link */}
          <label>
            Pull request or demo URL *
            <input
              type="url"
              value={prLink}
              onChange={(e) => setPrLink(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, prLink: true }))}
              placeholder="https://github.com/owner/repo/pull/123"
              aria-invalid={Boolean(prLinkError)}
              aria-describedby={prLinkError ? "prlink-error" : undefined}
              disabled={submitting}
            />
            <small className="field-hint">Link to your PR, branch, or live demo</small>
            {prLinkError && (
              <small className="field-error" id="prlink-error">{prLinkError}</small>
            )}
          </label>

          {/* Checklist items */}
          <fieldset className="checklist-fieldset">
            <legend>Pre-submission checklist</legend>

            <ChecklistItem
              id="check-linked"
              checked={issueLinked}
              onChange={setIssueLinked}
              disabled={submitting}
              label="PR is linked to the correct issue"
              hint={`Issue #${bounty.issueNumber} in ${bounty.repo}`}
            />

            <ChecklistItem
              id="check-pr-desc"
              checked={descriptionExplainsChanges}
              onChange={setDescriptionExplainsChanges}
              disabled={submitting}
              label="PR description explains the changes"
              hint="Your PR has a clear title and description"
            />

            <ChecklistItem
              id="check-ci"
              checked={ciChecksPass}
              onChange={setCiChecksPass}
              disabled={submitting}
              label="All CI checks pass"
              hint="The latest PR checks are green"
            />
          </fieldset>

          {/* Notes */}
          <label>
            Notes for the maintainer
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the maintainer should know about your approach, trade-offs, or follow-up work..."
              rows={3}
              disabled={submitting}
            />
          </label>

          <div className="submission-modal__actions">
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
              disabled={!canSubmit}
            >
              {submitting ? "Submitting..." : "Submit work"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

function ChecklistItem({
  id,
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  label: string;
  hint: string;
}) {
  return (
    <div className="checklist-item">
      <button
        type="button"
        id={id}
        role="checkbox"
        aria-checked={checked}
        className={`checklist-item__toggle ${checked ? "checklist-item__toggle--checked" : ""}`}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        aria-label={label}
      >
        {checked ? <CheckSquare size={18} /> : <Square size={18} />}
      </button>
      <div className="checklist-item__text">
        <label htmlFor={id} className={checked ? "checklist-item__label--done" : ""}>
          {label}
        </label>
        <small className="field-hint">{hint}</small>
      </div>
    </div>
  );
}
