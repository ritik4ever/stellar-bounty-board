import { useCallback, useEffect, useState, useRef } from 'react';

const WALLET_STORAGE_KEY = 'stellar-bounty-board-wallet';

/**
 * useWallet – Simple wallet hook for ContributorDashboard.
 *
 * Uses Freighter's browser API (window.freighter) directly to avoid
 * depending on @stellar/freighter-api. For richer wallet features
 * (signing, network detection), use useFreighter or useAlbedo.
 */
export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    mountedRef.current = true;
    try {
      const stored = localStorage.getItem(WALLET_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed.publicKey === 'string') {
          setAddress(parsed.publicKey);
        } else if (typeof parsed === 'string') {
          // Legacy format: just the address string
          setAddress(parsed);
        }
      }
    } catch {
      // ignore corrupted storage
    }
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const connect = useCallback(async () => {
    try {
      if (typeof window === 'undefined' || !window.freighter) {
        window.alert(
          'Freighter wallet is not installed. Please install it from https://freighter.app/'
        );
        return;
      }

      const { isConnected: connected } = await window.freighter.isConnected();
      if (!connected) {
        window.alert(
          'Freighter wallet is not connected. Please unlock Freighter and allow this site.'
        );
        return;
      }

      const publicKey = await window.freighter.getPublicKey();
      if (mountedRef.current && publicKey) {
        setAddress(publicKey);
        try {
          localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({ publicKey }));
        } catch {
          // ignore storage errors
        }
      }
    } catch (error) {
      console.error('Failed to connect to Freighter:', error);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    try {
      localStorage.removeItem(WALLET_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return {
    address,
    isConnected: Boolean(address),
    connect,
    disconnect,
  };
}
