import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface WalletState {
  address: string | null;
  network: string | null;
  isConnected: boolean;
}

interface WalletContextType {
  wallet: WalletState;
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnecting: boolean;
}

const WalletContext = createContext<WalletContextType>({
  wallet: { address: null, network: null, isConnected: false },
  connect: async () => {},
  disconnect: () => {},
  isConnecting: false,
});

export const useWallet = () => useContext(WalletContext);

interface WalletProviderProps {
  children: ReactNode;
  expectedNetwork?: string;
}

export const WalletProvider: React.FC<WalletProviderProps> = ({
  children,
  expectedNetwork = 'TESTNET',
}) => {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    network: null,
    isConnected: false,
  });
  const [isConnecting, setIsConnecting] = useState(false);

  const getNetworkPassphrase = (network: string): string => {
    switch (network) {
      case 'PUBLIC':
        return 'PUBLIC';
      case 'TESTNET':
        return 'TESTNET';
      default:
        return 'TESTNET';
    }
  };

  const connect = useCallback(async () => {
    if (typeof window === 'undefined' || !(window as any).freighter) {
      alert('Freighter wallet not detected. Please install Freighter extension.');
      return;
    }

    setIsConnecting(true);
    try {
      const freighter = (window as any).freighter;
      const { address } = await freighter.connect();
      const network = await freighter.getNetwork();
      const networkPassphrase = getNetworkPassphrase(network);

      setWallet({
        address,
        network: networkPassphrase,
        isConnected: true,
      });
    } catch (error) {
      console.error('Failed to connect Freighter:', error);
      setWallet({ address: null, network: null, isConnected: false });
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet({ address: null, network: null, isConnected: false });
  }, []);

  // Check if already connected on mount
  useEffect(() => {
    const checkConnection = async () => {
      if (typeof window !== 'undefined' && (window as any).freighter) {
        try {
          const freighter = (window as any).freighter;
          const { address } = await freighter.connect();
          const network = await freighter.getNetwork();
          const networkPassphrase = getNetworkPassphrase(network);

          setWallet({
            address,
            network: networkPassphrase,
            isConnected: true,
          });
        } catch {
          // Not connected
        }
      }
    };
    checkConnection();
  }, []);

  return (
    <WalletContext.Provider value={{ wallet, connect, disconnect, isConnecting }}>
      {children}
    </WalletContext.Provider>
  );
};
