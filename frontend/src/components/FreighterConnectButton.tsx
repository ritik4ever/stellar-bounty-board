/**
 * FreighterConnectButton – A button that connects/disconnects the Freighter wallet.
 *
 * Shows:
 *  - "Connect Freighter" when not connected
 *  - The truncated public key when connected
 *  - An error banner when there's a connection/network issue
 */

import { useFreighter, type FreighterError } from "../hooks/useFreighter";

interface FreighterConnectButtonProps {
  freighter: ReturnType<typeof useFreighter>;
  compact?: boolean;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function FreighterErrorBanner({ error }: { error: FreighterError | null }) {
  if (!error) return null;

  const colorMap: Record<string, string> = {
    NO_FREIGHTER: "#e74c3c",
    NOT_CONNECTED: "#f39c12",
    WRONG_NETWORK: "#e67e22",
    USER_REJECTED: "#95a5a6",
    SIGNING_FAILED: "#e74c3c",
  };

  return (
    <div
      className="freighter-error-banner"
      role="alert"
      style={{
        backgroundColor: colorMap[error.code] ?? "#e74c3c",
        color: "#fff",
        padding: "8px 12px",
        borderRadius: "6px",
        fontSize: "13px",
        marginBottom: "8px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <span style={{ fontWeight: 600, flexShrink: 0 }}>
        {error.code === "NO_FREIGHTER" && "⚠️"}
        {error.code === "NOT_CONNECTED" && "🔒"}
        {error.code === "WRONG_NETWORK" && "🌐"}
        {error.code === "USER_REJECTED" && "✋"}
        {error.code === "SIGNING_FAILED" && "❌"}
      </span>
      <span>{error.message}</span>
    </div>
  );
}

export default function FreighterConnectButton({
  freighter,
  compact = false,
}: FreighterConnectButtonProps) {
  const { isConnected, publicKey, connecting, error, connect, disconnect } = freighter;

  if (isConnected && publicKey) {
    return (
      <div className="freighter-connected-row">
        {!compact && <FreighterErrorBanner error={error} />}
        <div
          className="freighter-connected"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 12px",
            borderRadius: "6px",
            backgroundColor: "var(--color-surface, #1a1a2e)",
            border: "1px solid var(--color-border, #2d2d4e)",
            fontSize: "13px",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: error ? "#e74c3c" : "#2ecc71",
              display: "inline-block",
              flexShrink: 0,
            }}
            aria-label={error ? "Error" : "Connected"}
          />
          <span style={{ fontFamily: "monospace" }}>{shortAddress(publicKey)}</span>
          <button
            type="button"
            className="ghost-button"
            onClick={disconnect}
            style={{ fontSize: "12px", padding: "2px 8px", marginLeft: "4px" }}
            aria-label="Disconnect Freighter"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="freighter-connect-row">
      {!compact && <FreighterErrorBanner error={error} />}
      <button
        type="button"
        className="secondary-button"
        onClick={connect}
        disabled={connecting}
        style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
        aria-label="Connect Freighter wallet"
      >
        {connecting ? (
          "Connecting..."
        ) : (
          <>
            <span role="img" aria-label="wallet">💳</span>
            Connect Freighter
          </>
        )}
      </button>
    </div>
  );
}

export { FreighterErrorBanner };