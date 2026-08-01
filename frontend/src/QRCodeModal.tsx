import { useEffect, useRef, useState } from "react";
import { X, QrCode } from "lucide-react";
import QRCode from "qrcode";

interface Props {
  address: string;
  label: string;
  onClose: () => void;
}

/**
 * A modal that displays a QR code for a wallet address.
 *
 * - Generates the QR code client-side using the `qrcode` library (no external network calls).
 * - Closes on Escape or backdrop click.
 * - Traps focus inside while open.
 * - Styled to match the existing modal patterns in the project.
 */
export default function QRCodeModal({ address, label, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    closeBtnRef.current?.focus();

    QRCode.toDataURL(address, {
      width: 280,
      margin: 2,
      color: {
        dark: "#1f2421",
        light: "#ffffff",
      },
    })
      .then(setDataUrl)
      .catch((err) => {
        console.error("QR code generation failed:", err);
        setError("Failed to generate QR code.");
      });
  }, [address]);

  // Close on backdrop click
  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  // Close on Escape
  function handleCancel(e: React.SyntheticEvent) {
    e.preventDefault();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="qr-modal"
      onClick={handleDialogClick}
      onCancel={handleCancel}
      aria-labelledby="qr-modal-title"
      aria-modal="true"
    >
      <div className="qr-modal__inner">
        <div className="qr-modal__header">
          <div>
            <span className="panel-kicker">{label}</span>
            <h2 id="qr-modal-title">Scan QR Code</h2>
          </div>
        </div>

        <div className="qr-modal__body">
          {error ? (
            <p className="qr-modal__error" role="alert">
              {error}
            </p>
          ) : dataUrl ? (
            <>
              <img
                src={dataUrl}
                alt={`QR code for ${label}: ${address}`}
                className="qr-modal__image"
                width={280}
                height={280}
              />
              <p className="qr-modal__address">{address}</p>
            </>
          ) : (
            <p className="qr-modal__loading">Generating QR code…</p>
          )}
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

/**
 * A small icon button that opens the QR code modal for a given address.
 * Intended to be placed next to a wallet address in the bounty detail page.
 */
export function QRCodeButton({
  address,
  label,
}: {
  address: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="qr-button"
        aria-label={`Show QR code for ${label}`}
        title="Show QR code"
        onClick={() => setOpen(true)}
      >
        <QrCode size={16} />
      </button>
      {open && (
        <QRCodeModal
          address={address}
          label={label}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}