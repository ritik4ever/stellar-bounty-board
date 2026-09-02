import { useCallback } from 'react';

import { useLocalStorage } from './useLocalStorage';
import { isConnected as checkIsFreighterConnected, requestAccess } from '@stellar/freighter-api';

const WALLET_STORAGE_KEY = 'stellar-bounty-board-wallet';

export function useWallet() {
  const [address, setAddress] = useLocalStorage<string | null>(WALLET_STORAGE_KEY, null);

  const connect = useCallback(async () => {
    try {
      const installed = await checkIsFreighterConnected();
      if (!installed) {
        window.alert('Freighter wallet is not installed. Please install it from https://freighter.app/');
        return;
      }

      const response = await requestAccess();
      if (response && typeof response === 'object' && 'address' in response && typeof response.address === 'string') {
        setAddress(response.address);
      } else if (typeof response === 'string') {
        setAddress(response);
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
