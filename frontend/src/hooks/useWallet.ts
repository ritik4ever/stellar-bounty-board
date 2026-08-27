import { useCallback } from 'react';

import { useLocalStorage } from './useLocalStorage';
import { isConnected as checkIsFreighterConnected, requestAccess } from '@stellar/freighter-api';

const WALLET_STORAGE_KEY = 'stellar-bounty-board-wallet';

export function useWallet() {
  const [address, setAddress] = useLocalStorage<string | null>(WALLET_STORAGE_KEY, null);

  const connect = useCallback(async () => {
    try {
      const { isConnected: connected } = await checkIsFreighterConnected();
      if (!connected) {
        window.alert(
          'Freighter wallet is not installed. Please install it from https://freighter.app/'
        );
        return;
      }

      const { address } = await requestAccess();
      if (address) {
        setAddress(address);
      }
    } catch (error) {
      console.error('Failed to connect to Freighter:', error);
    }
  }, [setAddress]);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, [setAddress]);

  return {
    address,
    isConnected: Boolean(address),
    connect,
    disconnect,
  };
}
