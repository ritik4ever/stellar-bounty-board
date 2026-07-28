import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface DisconnectConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog shown before disconnecting the wallet.
 * Uses a native <dialog> element with showModal() for a focus-trapped,
 * keyboard-accessible modal that closes on Escape or backdrop click.
 */
export default function DisconnectConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
}: DisconnectConfirmModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
      // Focus the confirm button when the modal opens
      setTimeout(() => confirmRef.current?.focus(), 0);
    } else {
      if (typeof dialog.close === 'function') {
        dialog.close();
      }
    }
  }, [isOpen]);

  // Close on backdrop click
  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onCancel();
  }

  // Prevent Escape from closing the native dialog — we handle it ourselves
  // so we can always call onCancel instead of the dialog's default close
  function handleCancel(e: React.SyntheticEvent<HTMLDialogElement>) {
    e.preventDefault();
    onCancel();
  }

  function handleDialogKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }

    // Focus trap for Tab / Shift+Tab
    if (e.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = [
      confirmRef.current,
      dialog.querySelector<HTMLElement>('.disconnect-modal__cancel-btn'),
      dialog.querySelector<HTMLElement>('.disconnect-modal__close-btn'),
    ].filter((el): el is HTMLElement => Boolean(el));

    if (focusable.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }

    const currentIndex = focusable.findIndex(
      (el) => el === document.activeElement,
    );
    const nextIndex = e.shiftKey
      ? currentIndex <= 0
        ? focusable.length - 1
        : currentIndex - 1
      : currentIndex === -1 || currentIndex === focusable.length - 1
        ? 0
        : currentIndex + 1;

    e.preventDefault();
    focusable[nextIndex].focus();
  }

  return (
    <dialog
      ref={dialogRef}
      className="disconnect-modal"
      onClick={handleDialogClick}
      onCancel={handleCancel}
      onKeyDown={handleDialogKeyDown}
      aria-labelledby="disconnect-modal-title"
      aria-describedby="disconnect-modal-desc"
      aria-modal="true"
    >
      <div className="disconnect-modal__inner">
        <div className="disconnect-modal__header">
          <h2 id="disconnect-modal-title">Disconnect wallet</h2>
        </div>

        <p id="disconnect-modal-desc" className="disconnect-modal__desc">
          Are you sure you want to disconnect your wallet? Your session will be
          cleared and you will need to re-connect to view personalized
          recommendations and metrics.
        </p>

        <div className="disconnect-modal__actions">
          <button
            type="button"
            className="ghost-button disconnect-modal__cancel-btn"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="disconnect-modal__confirm-btn"
            onClick={onConfirm}
          >
            Disconnect
          </button>
        </div>

        <button
          type="button"
          className="modal-close-btn disconnect-modal__close-btn"
          aria-label="Close"
          onClick={onCancel}
        >
          <X size={18} />
        </button>
      </div>
    </dialog>
  );
}