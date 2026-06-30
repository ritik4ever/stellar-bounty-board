import React from 'react';
import { toast } from 'sonner';
import { Wallet } from 'lucide-react';
import { useWallet } from '../context/WalletContext';

export function WalletConnect() {
  const { 
    isConnected, 
    address, 
    network, 
    isWrongNetwork, 
    isConnecting, 
    connect, 
    disconnect 
  } = useWallet();

  const handleConnect = async () => {
    try {
      await connect();
      toast.success('Wallet connected!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to connect wallet.');
    }
  };

  const handleDisconnect = () => {
    disconnect();
    toast.success('Wallet disconnected.');
  };

  if (isConnected && address) {
    const displayAddress = `${address.slice(0, 6)}...${address.slice(-3)}`;
    const formattedNetwork = network === 'PUBLIC' ? 'Mainnet' : network === 'TESTNET' ? 'Testnet' : network || 'Unknown';
    return (
      <div className="wallet-pill-container">
        {isWrongNetwork && (
          <span 
            className="network-warning-badge" 
            role="alert" 
            aria-live="polite"
            title="Wallet is on Mainnet (Public), but this app expects Testnet. Actions will fail."
          >
            Mainnet! Use Testnet
          </span>
        )}
        <button
          className={`wallet-pill ${isWrongNetwork ? 'wallet-pill--warning' : ''}`}
          onClick={handleDisconnect}
          aria-label={`Connected as ${address}. Network: ${formattedNetwork}. Click to disconnect.`}
          title="Click to disconnect"
        >
          <Wallet size={16} />
          <span className="wallet-address">{displayAddress}</span>
          <span className="network-indicator">• {formattedNetwork}</span>
          <span className="disconnect-hover-text">Disconnect</span>
        </button>
      </div>
    );
  }

  return (
    <button
      className="primary-button wallet-connect-btn"
      onClick={handleConnect}
      disabled={isConnecting}
      aria-label={isConnecting ? 'Connecting to Freighter wallet...' : 'Connect Freighter Wallet'}
    >
      <Wallet size={16} style={{ marginRight: '8px' }} />
      {isConnecting ? 'Connecting...' : 'Connect Wallet'}
    </button>
  );
}
