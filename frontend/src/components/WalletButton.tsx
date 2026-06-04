import React, { useState } from 'react';
import { useWallet } from '../context/WalletContext';

const WalletButton: React.FC = () => {
  const { wallet, connect, disconnect, isConnecting } = useWallet();
  const [showDisconnect, setShowDisconnect] = useState(false);

  const truncateAddress = (address: string): string => {
    if (!address) return '';
    return `${address.slice(0, 5)}...${address.slice(-3)}`;
  };

  const getNetworkLabel = (network: string | null): string => {
    switch (network) {
      case 'PUBLIC':
        return 'Mainnet';
      case 'TESTNET':
        return 'Testnet';
      default:
        return 'Unknown';
    }
  };

  const isWrongNetwork = wallet.isConnected && wallet.network === 'PUBLIC';

  if (!wallet.isConnected) {
    return (
      <button
        onClick={connect}
        disabled={isConnecting}
        aria-label="Connect Freighter wallet"
        className="wallet-button wallet-button--connect"
        style={{
          padding: '8px 16px',
          borderRadius: '8px',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: '14px',
          backgroundColor: '#7c3aed',
          color: '#fff',
          transition: 'background-color 0.2s',
        }}
        onMouseEnter={(e) => {
          (e.target as HTMLButtonElement).style.backgroundColor = '#6d28d9';
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLButtonElement).style.backgroundColor = '#7c3aed';
        }}
      >
        {isConnecting ? 'Connecting...' : 'Connect Wallet'}
      </button>
    );
  }

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShowDisconnect(true)}
      onMouseLeave={() => setShowDisconnect(false)}
      onFocus={() => setShowDisconnect(true)}
      onBlur={() => setShowDisconnect(false)}
    >
      <button
        aria-label={`Connected as ${truncateAddress(wallet.address || '')} on ${getNetworkLabel(wallet.network)}`}
        className={`wallet-button wallet-button--connected ${isWrongNetwork ? 'wallet-button--wrong-network' : ''}`}
        style={{
          padding: '8px 16px',
          borderRadius: '8px',
          border: isWrongNetwork ? '2px solid #ef4444' : '2px solid #10b981',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: '14px',
          backgroundColor: isWrongNetwork ? '#fef2f2' : '#f0fdf4',
          color: isWrongNetwork ? '#dc2626' : '#16a34a',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>{truncateAddress(wallet.address || '')}</span>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '12px',
            backgroundColor: isWrongNetwork ? '#fee2e2' : '#dcfce7',
            color: isWrongNetwork ? '#dc2626' : '#16a34a',
          }}
        >
          {getNetworkLabel(wallet.network)}
        </span>
      </button>
      {showDisconnect && (
        <button
          onClick={disconnect}
          aria-label="Disconnect wallet"
          className="wallet-button wallet-button--disconnect"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '4px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '14px',
            backgroundColor: '#fff',
            color: '#ef4444',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
            zIndex: 10,
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.backgroundColor = '#fef2f2';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.backgroundColor = '#fff';
          }}
        >
          Disconnect
        </button>
      )}
    </div>
  );
};

export default WalletButton;
