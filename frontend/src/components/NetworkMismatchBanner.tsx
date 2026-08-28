/**
 * NetworkMismatchBanner – A persistent warning shown when the connected
 * Freighter wallet is on a different Stellar network than the app expects.
 *
 * Renders the wallet's current network alongside the app's expected network
 * and links to Freighter's guide for switching networks. Mutating actions
 * (release/refund/dispute) stay disabled while this banner is visible.
 */

import { STELLAR_NETWORK } from "../hooks/useFreighter";

interface NetworkMismatchBannerProps {
  walletNetwork: string | null;
}

const FREIGHTER_SWITCH_NETWORKS_URL = "https://help.freighter.app/";

export default function NetworkMismatchBanner({ walletNetwork }: NetworkMismatchBannerProps) {
  return (
    <div className="network-mismatch-banner" role="alert">
      <div className="network-mismatch-banner__content">
        <strong>Wrong Stellar network detected</strong>
        <p>
          Your wallet is connected to <span className="network-mismatch-banner__network">{walletNetwork ?? "unknown"}</span>,
          but this app expects{" "}
          <span className="network-mismatch-banner__network">{STELLAR_NETWORK}</span>. Release and
          refund actions are disabled until you switch networks.
        </p>
        <p>
          Open the Freighter extension, click the network selector in the bottom bar, and choose{" "}
          {STELLAR_NETWORK}.{" "}
          <a
            className="network-mismatch-banner__link"
            href={FREIGHTER_SWITCH_NETWORKS_URL}
            target="_blank"
            rel="noreferrer"
          >
            Freighter help center
          </a>
        </p>
      </div>
    </div>
  );
}
