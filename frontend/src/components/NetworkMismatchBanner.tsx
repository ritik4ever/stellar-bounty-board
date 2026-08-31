/**
 * NetworkMismatchBanner – Persistent warning banner that shows when the wallet
 * is connected to the wrong Stellar network.
 *
 * Renders a dismissible banner at the top of the app layout with instructions
 * to switch to the correct network in Freighter.
 */
import { useFreighter, STELLAR_NETWORK } from "../hooks/useFreighter";
import { useState } from "react";

interface NetworkMismatchBannerProps {
  freighter: ReturnType<typeof useFreighter>;
}

export default function NetworkMismatchBanner({ freighter }: NetworkMismatchBannerProps) {
  const { isConnected, isOnCorrectNetwork } = freighter;
  const [dismissed, setDismissed] = useState(false);

  if (!isConnected || isOnCorrectNetwork || dismissed) {
    return null;
  }

  return (
    <div className="network-mismatch-banner" role="alert">
      <span className="network-mismatch-banner__icon">🌐</span>
      <div className="network-mismatch-banner__content">
        <strong className="network-mismatch-banner__title">Wrong Network Detected</strong>
        <p className="network-mismatch-banner__message">
          Your wallet is connected to the wrong Stellar network. Please switch to{" "}
          <strong>{STELLAR_NETWORK}</strong> in your Freighter wallet extension to
          release payouts, refund bounties, or perform other mutating actions.
        </p>
      </div>
      <button
        type="button"
        className="network-mismatch-banner__dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss network warning"
      >
        ✕
      </button>
    </div>
  );
}