/**
 * WalletSelector – Lets users choose between Freighter and xBull wallets.
 *
 * Behaviour:
 *  - If a wallet is installed, shows a connect/disconnect button for it.
 *  - If a wallet is NOT installed, shows an install prompt link.
 *  - Selecting a wallet type makes it active and triggers connect().
 *  - Error messages are shown inline below the active wallet button.
 */

import { type WalletState, type WalletType } from '../hooks/useWallet';
import { isFreighterInstalled } from '../hooks/useFreighter';
import { isXBullInstalled } from '../hooks/useXBull';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WALLET_META: Record<WalletType, { label: string; icon: string; installUrl: string }> = {
  freighter: {
    label: 'Freighter',
    icon: '🚀',
    installUrl: 'https://freighter.app',
  },
  xbull: {
    label: 'xBull',
    icon: '🐂',
    installUrl: 'https://xbull.app',
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

interface InstallPromptProps {
  walletType: WalletType;
}

function InstallPrompt({ walletType }: InstallPromptProps) {
  const meta = WALLET_META[walletType];
  return (
    <a
      href={meta.installUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="wallet-install-prompt"
      aria-label={`Install ${meta.label} wallet extension`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '6px',
        fontSize: '13px',
        color: 'var(--color-text-muted, #888)',
        border: '1px dashed var(--color-border, #2d2d4e)',
        textDecoration: 'none',
        cursor: 'pointer',
      }}
    >
      <span role="img" aria-hidden="true">
        {meta.icon}
      </span>
      Install {meta.label}
    </a>
  );
}

interface WalletButtonProps {
  walletType: WalletType;
  wallet: WalletState;
  isInstalled: boolean;
}

function WalletButton({ walletType, wallet, isInstalled }: WalletButtonProps) {
  const meta = WALLET_META[walletType];
  const isActive = wallet.activeWallet === walletType;
  const isThisConnected = isActive && wallet.isConnected;
  const isThisConnecting = isActive && wallet.connecting;

  if (!isInstalled) {
    return <InstallPrompt walletType={walletType} />;
  }

  if (isThisConnected && wallet.publicKey) {
    return (
      <div
        className="wallet-connected"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          borderRadius: '6px',
          backgroundColor: 'var(--color-surface, #1a1a2e)',
          border: '1px solid var(--color-border, #2d2d4e)',
          fontSize: '13px',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: wallet.errorMessage ? '#e74c3c' : '#2ecc71',
            display: 'inline-block',
            flexShrink: 0,
          }}
          aria-label={wallet.errorMessage ? 'Wallet error' : 'Connected'}
        />
        <span role="img" aria-hidden="true">
          {meta.icon}
        </span>
        <span style={{ fontFamily: 'monospace' }}>{shortAddress(wallet.publicKey)}</span>
        <button
          type="button"
          className="ghost-button"
          onClick={wallet.disconnect}
          style={{ fontSize: '12px', padding: '2px 8px', marginLeft: '4px' }}
          aria-label={`Disconnect ${meta.label} wallet`}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="secondary-button"
      disabled={isThisConnecting}
      onClick={async () => {
        wallet.setActiveWallet(walletType);
        await wallet.connect();
      }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
      aria-label={`Connect ${meta.label} wallet`}
    >
      {isThisConnecting ? (
        'Connecting...'
      ) : (
        <>
          <span role="img" aria-hidden="true">
            {meta.icon}
          </span>
          {`Connect ${meta.label}`}
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------
interface ErrorBannerProps {
  message: string | null;
}

function WalletErrorBanner({ message }: ErrorBannerProps) {
  if (!message) return null;

  // Detect the NO_XBULL / NO_FREIGHTER install-prompt case so we can render
  // a link rather than just text.
  const isXBullInstallError =
    message.toLowerCase().includes('xbull') && message.toLowerCase().includes('not installed');
  const isFreighterInstallError =
    message.toLowerCase().includes('freighter') && message.toLowerCase().includes('not installed');

  return (
    <div
      className="wallet-error-banner"
      role="alert"
      style={{
        backgroundColor: '#e74c3c',
        color: '#fff',
        padding: '8px 12px',
        borderRadius: '6px',
        fontSize: '13px',
        marginTop: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
      }}
    >
      <span>⚠️ {message}</span>
      {isXBullInstallError && (
        <a
          href={WALLET_META.xbull.installUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#fff', fontWeight: 600 }}
          aria-label="Install xBull wallet extension"
        >
          Install xBull →
        </a>
      )}
      {isFreighterInstallError && (
        <a
          href={WALLET_META.freighter.installUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#fff', fontWeight: 600 }}
          aria-label="Install Freighter wallet extension"
        >
          Install Freighter →
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface WalletSelectorProps {
  wallet: WalletState;
  /** When true, omits the error banner (used in the compact header slot). */
  compact?: boolean;
}

export default function WalletSelector({ wallet, compact = false }: WalletSelectorProps) {
  const freighterInstalled = isFreighterInstalled();
  const xbullInstalled = isXBullInstalled();

  return (
    <div
      className="wallet-selector"
      style={{ display: 'inline-flex', flexDirection: 'column', gap: '4px' }}
    >
      <div
        className="wallet-selector-buttons"
        style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap' }}
      >
        <WalletButton walletType="freighter" wallet={wallet} isInstalled={freighterInstalled} />
        <WalletButton walletType="xbull" wallet={wallet} isInstalled={xbullInstalled} />
      </div>

      {!compact && <WalletErrorBanner message={wallet.errorMessage} />}
    </div>
  );
}

export { WalletErrorBanner };
