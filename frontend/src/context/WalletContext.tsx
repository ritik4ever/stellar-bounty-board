import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { isConnected, getPublicKey, getNetwork } from '@stellar/freighter-api';

interface WalletContextType {
  isConnected: boolean;
  address: string | null;
  network: string | null;
  isWrongNetwork: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check connection on load if an address was saved
  useEffect(() => {
    const savedAddress = localStorage.getItem('freighter_address');
    if (savedAddress) {
      checkConnection();
    }
  }, []);

  const checkConnection = async () => {
    try {
      if (await isConnected()) {
        const pk = await getPublicKey();
        const net = await getNetwork();
        if (pk) {
          setAddress(pk);
          setNetwork(net || 'TESTNET');
          localStorage.setItem('freighter_address', pk);
        }
      }
    } catch (err: any) {
      console.error('Failed to restore wallet connection:', err);
    }
  };

  const connect = async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const connected = await isConnected();
      if (!connected) {
        throw new Error('Freighter extension not detected.');
      }
      const pk = await getPublicKey();
      if (!pk) {
        throw new Error('No account found or user rejected connection.');
      }
      const net = await getNetwork();
      setAddress(pk);
      setNetwork(net || 'TESTNET');
      localStorage.setItem('freighter_address', pk);
    } catch (err: any) {
      setError(err.message || 'Connection failed.');
      throw err;
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    setAddress(null);
    setNetwork(null);
    localStorage.removeItem('freighter_address');
  };

  const isConnectedState = !!address;
  // If the wallet is on public network, getNetwork returns 'PUBLIC'. App expects 'TESTNET'.
  const isWrongNetwork = isConnectedState && network?.toUpperCase() === 'PUBLIC';

  return (
    <WalletContext.Provider
      value={{
        isConnected: isConnectedState,
        address,
        network: network ? network.toUpperCase() : null,
        isWrongNetwork,
        isConnecting,
        error,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

const defaultWalletContext: WalletContextType = {
  isConnected: false,
  address: null,
  network: null,
  isWrongNetwork: false,
  isConnecting: false,
  error: null,
  connect: async () => {},
  disconnect: () => {},
};

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    return defaultWalletContext;
  }
  return context;
}
