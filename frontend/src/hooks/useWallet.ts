import { useCallback, useState, useEffect } from 'react';

import { useLocalStorage } from './useLocalStorage';
import { isConnected as checkIsFreighterConnected, requestAccess, getNetworkDetails } from '@stellar/freighter-api';
import { STELLAR_NETWORK_PASSPHRASE } from '../api';

const WALLET_STORAGE_KEY = 'stellar-bounty-board-wallet';
const STELLAR_NETWORK = import.meta.env.VITE_STELLAR_NETWORK ?? 'TESTNET';

export function useWallet() {
  const [address, setAddress] = useLocalStorage<string | null>(WALLET_STORAGE_KEY, null);
  const [networkMismatch, setNetworkMismatch] = useState(false);
  const [activeNetwork, setActiveNetwork] = useState<string>('');

  const checkNetwork = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && window.freighter) {
        const { networkPassphrase, network } = await window.freighter.getNetwork();
        setNetworkMismatch(networkPassphrase !== STELLAR_NETWORK_PASSPHRASE);
        setActiveNetwork(network || 'UNKNOWN');
      } else {
        const details = await getNetworkDetails();
        setNetworkMismatch(details.networkPassphrase !== STELLAR_NETWORK_PASSPHRASE);
        setActiveNetwork(details.network || 'UNKNOWN');
      }
    } catch (e) {
      console.error('Failed to check network', e);
    }
  }, []);

  useEffect(() => {
    if (address) {
      checkNetwork();
    }
  }, [address, checkNetwork]);

  const connect = useCallback(async () => {
    try {
      const installed = await checkIsFreighterConnected();
      if (!installed) {
        window.alert('Freighter wallet is not installed. Please install it from https://freighter.app/');
        return;
      }

      const publicKey = await requestAccess();
      if (publicKey) {
        setAddress(publicKey);
        await checkNetwork();
      }
    } catch (error) {
      console.error('Failed to connect to Freighter:', error);
    }
  }, [setAddress, checkNetwork]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setNetworkMismatch(false);
    setActiveNetwork('');
  }, [setAddress]);

  return {
    address,
    isConnected: Boolean(address),
    networkMismatch,
    activeNetwork,
    expectedNetwork: STELLAR_NETWORK,
    connect,
    disconnect,
  };
}
