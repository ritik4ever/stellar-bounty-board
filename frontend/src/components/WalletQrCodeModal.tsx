import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import QRCode from 'qrcode';

interface WalletQrCodeModalProps {
  address: string;
  onClose: () => void;
}

/**
 * Shows a maintainer's funding address as a scannable QR code inside a modal.
 *
 * - The QR code is generated entirely client-side as an SVG (no external
 *   network calls), so it stays crisp at any size/DPI and scans reliably from
 *   a phone.
 * - The exact address string is rendered alongside the code so users can
 *   verify the QR encodes what the text shows before funding the bounty.
 * - Focus moves to the Close button on open; Escape or backdrop click closes.
 */
export default function WalletQrCodeModal({ address, onClose }: WalletQrCodeModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // QR generation is pure and needs no DOM, so generate once on mount.
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(address, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 200,
    })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setQrError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    dialogRef.current?.showModal();
    closeBtnRef.current?.focus();
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="qr-modal"
      onClick={handleDialogClick}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      aria-labelledby="qr-modal-title"
      aria-modal="true"
    >
      <div className="qr-modal__inner">
        <div className="qr-modal__header">
          <div>
            <span className="panel-kicker">Wallet</span>
            <h2 id="qr-modal-title">Funding address QR code</h2>
          </div>
        </div>

        <div className="qr-modal__body">
          <div
            className="qr-modal__qr"
            role="img"
            aria-label={`QR code for wallet address ${address}`}
          >
            {qrSvg ? (
              <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
            ) : (
              <p className="qr-modal__error" role="alert">
                {qrError ? 'Could not generate a QR code for this address.' : 'Generating QR code…'}
              </p>
            )}
          </div>
          <p className="qr-modal__hint">
            Scan with your wallet app to fund this bounty&apos;s maintainer wallet.
          </p>
          <strong className="qr-modal__address">{address}</strong>
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
