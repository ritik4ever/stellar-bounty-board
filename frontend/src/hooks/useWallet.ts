import { useCallback } from 'react';

import { useLocalStorage } from './useLocalStorage';

const WALLET_STORAGE_KEY = 'stellar-bounty-board-wallet';

const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z0-9]{55}$/;

export function useWallet() {
  const [address, setAddress] = useLocalStorage<string | null>(WALLET_STORAGE_KEY, null);

  const connect = useCallback(() => {
    const input = window.prompt('Enter your Stellar public key');
    if (!input) return;

    const trimmed = input.trim();
    if (!STELLAR_PUBLIC_KEY_REGEX.test(trimmed)) {
      window.alert('Enter a valid Stellar public key (starts with G, 56 characters).');
      return;
    }

    setAddress(trimmed);
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
