import { useCallback } from 'react';

import { useLocalStorage } from './useLocalStorage';
import {
  isConnected as checkIsFreighterConnected,
  requestAccess,
  signTransaction,
  submitTransaction,
  getNetworkDetails,
} from '@stellar/freighter-api';

const WALLET_STORAGE_KEY = 'stellar-bounty-board-wallet';

export function useWallet(arbiterAddress?: string | null) {
  const [address, setAddress] = useLocalStorage<string | null>(WALLET_STORAGE_KEY, null);

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
      }
    } catch (error) {
      console.error('Failed to connect to Freighter:', error);
    }
  }, [setAddress]);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, [setAddress]);

  const signAndSubmit = useCallback(async (transactionXdr: string) => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    const networkDetails = await getNetworkDetails();
    const signedTransactionXdr = await signTransaction(transactionXdr, {
      networkPassphrase: networkDetails.networkPassphrase,
    });
    const result = await submitTransaction(signedTransactionXdr);
    return result;
  }, [address]);

  const isArbiter = Boolean(address && arbiterAddress && address === arbiterAddress);

  return {
    address,
    isConnected: Boolean(address),
    isArbiter,
    connect,
    disconnect,
    signAndSubmit,
  };
}