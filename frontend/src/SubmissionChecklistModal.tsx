import { FormEvent, useEffect, useRef, useState } from "react";
import { CheckSquare, Square, X } from "lucide-react";
import type { Bounty } from "./types";

export interface SubmissionFormData {
  contributor: string;
  prLink: string;
  testsWritten: boolean;
  notes: string;
}

/**
 * Required pre-flight checklist. A contributor cannot submit a PR link until
 * every one of these items has been explicitly acknowledged.
 */
export const CHECKLIST_ITEMS = [
  {
    id: "check-linked",
    label: "PR is linked to the correct issue",
    hint: "Your PR references the issue this bounty tracks",
  },
  {
    id: "check-pr-desc",
    label: "PR description explains the changes",
    hint: "The PR has a clear title and description",
  },
  {
    id: "check-ci",
    label: "All CI checks pass",
    hint: "Tests, lint, and build are green on the PR",
  },
] as const;

type ChecklistId = (typeof CHECKLIST_ITEMS)[number]["id"];

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
  const [testsWritten] = useState(initialData?.testsWritten ?? false);
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [checklist, setChecklist] = useState<Record<ChecklistId, boolean>>(() =>
    CHECKLIST_ITEMS.reduce(
      (acc, item) => ({ ...acc, [item.id]: false }),
      {} as Record<ChecklistId, boolean>,
    ),
  );

  const allChecked = CHECKLIST_ITEMS.every((item) => checklist[item.id]);
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

  function handleDialogKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const orderedFocusable = [
      firstInputRef.current,
      dialog.querySelector<HTMLElement>('input[type="url"]:not(:disabled)'),
      dialog.querySelector<HTMLElement>('.checklist-item__toggle:not(:disabled)'),
      dialog.querySelector<HTMLElement>('textarea:not(:disabled)'),
      ...Array.from(dialog.querySelectorAll<HTMLElement>('.submission-modal__actions button:not(:disabled)')),
      dialog.querySelector<HTMLElement>('.modal-close-btn:not(:disabled)'),
    ].filter((element): element is HTMLElement => Boolean(element));

    if (orderedFocusable.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }

    const currentIndex = orderedFocusable.findIndex((element) => element === document.activeElement);
    const nextIndex = e.shiftKey
      ? (currentIndex <= 0 ? orderedFocusable.length - 1 : currentIndex - 1)
      : (currentIndex === -1 || currentIndex === orderedFocusable.length - 1 ? 0 : currentIndex + 1);

    e.preventDefault();
    orderedFocusable[nextIndex].focus();
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
    validateUrl(prLink) === null &&
    allChecked;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ contributor: true, prLink: true });
    if (!isValid) return;
    onSubmit({
      contributor: contributor.trim(),
      prLink: prLink.trim(),
      testsWritten,
      notes: notes.trim(),
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className="submission-modal"
      onClick={handleDialogClick}
      onCancel={handleCancel}
      onKeyDown={handleDialogKeyDown}
      aria-labelledby="modal-title"
      aria-modal="true"
    >
      <div className="submission-modal__inner">
        <div className="submission-modal__header">
          <div>
            <span className="panel-kicker">Submission checklist</span>
            <h2 id="modal-title">Submit your work</h2>
          </div>
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

          {/* Required pre-flight checklist — submission is blocked until all are checked */}
          <fieldset className="checklist-fieldset">
            <legend>Pre-submission checklist *</legend>

            {CHECKLIST_ITEMS.map((item) => (
              <ChecklistItem
                key={item.id}
                id={item.id}
                checked={checklist[item.id]}
                onChange={(value) =>
                  setChecklist((prev) => ({ ...prev, [item.id]: value }))
                }
                disabled={submitting}
                label={item.label}
                hint={item.id === "check-linked" ? `Issue #${bounty.issueNumber} in ${bounty.repo}` : item.hint}
              />
            ))}

            {!allChecked && (
              <small className="field-hint checklist-fieldset__hint">
                Check every item above to enable submission.
              </small>
            )}
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
              disabled={submitting || !isValid}
              aria-disabled={submitting || !isValid}
            >
              {submitting ? "Submitting..." : "Submit work"}
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
