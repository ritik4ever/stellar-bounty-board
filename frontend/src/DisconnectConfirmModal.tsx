import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface Props {
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * A confirmation modal shown before disconnecting the wallet.
 *
 * - Focus trap: Tab/Shift+Tab cycles through the two action buttons and the
 *   close button, wrapping around on each end.
 * - Escape closes the modal without disconnecting.
 * - Backdrop click closes the modal without disconnecting.
 */
export default function DisconnectConfirmModal({ onConfirm, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    // Focus the Cancel button by default (safer default than Confirm).
    cancelRef.current?.focus();
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

  // Focus trap
  function handleKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key !== "Tab") return;

    const buttons = [cancelRef.current, confirmRef.current, closeBtnRef.current].filter(
      (el): el is HTMLButtonElement => Boolean(el),
    );

    if (buttons.length === 0) {
      e.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const currentIndex = buttons.findIndex((el) => el === document.activeElement);
    const nextIndex = e.shiftKey
      ? currentIndex <= 0
        ? buttons.length - 1
        : currentIndex - 1
      : currentIndex === -1 || currentIndex === buttons.length - 1
        ? 0
        : currentIndex + 1;

    e.preventDefault();
    buttons[nextIndex]?.focus();
  }

  return (
    <dialog
      ref={dialogRef}
      className="disconnect-modal"
      onClick={handleDialogClick}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      aria-labelledby="disconnect-modal-title"
      aria-modal="true"
    >
      <div className="disconnect-modal__inner">
        <div className="disconnect-modal__header">
          <div>
            <span className="panel-kicker">Wallet</span>
            <h2 id="disconnect-modal-title">Disconnect Wallet</h2>
          </div>
        </div>

        <p className="disconnect-modal__body">
          Are you sure you want to disconnect your wallet? You'll need to
          reconnect to access your personalized dashboard and recommendations.
        </p>

        <div className="disconnect-modal__actions">
          <button
            ref={cancelRef}
            type="button"
            className="ghost-button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="primary-button primary-button--danger"
            onClick={onConfirm}
          >
            Disconnect
          </button>
        </div>

        <button
          ref={closeBtnRef}
          type="button"
          className="modal-close-btn"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
    </dialog>
  );
}