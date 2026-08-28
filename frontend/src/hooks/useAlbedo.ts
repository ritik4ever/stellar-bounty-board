/**
 * useAlbedo – React hook for interacting with the Albedo Stellar wallet.
 *
 * Provides:
 *  - Connection state (isConnected, publicKey)
 *  - signPayload() for signing canonical request payload objects
 *  - connect() / disconnect() lifecycle
 *  - Error state for popup blocked / user cancelled / network issues
 *
 * Albedo is a web-based wallet — it opens a popup window for
 * authentication and signing. No browser extension is required.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import albedo from '@albedo-link/intent';

export type AlbedoErrorCode =
  | 'POPUP_BLOCKED'
  | 'USER_CANCELLED'
  | 'CONNECTION_FAILED'
  | 'SIGNING_FAILED'
  | 'NETWORK_ERROR';

export interface AlbedoError {
  code: AlbedoErrorCode;
  message: string;
}

export interface AlbedoState {
  isConnected: boolean;
  publicKey: string | null;
  error: AlbedoError | null;
  connecting: boolean;
}

export interface AlbedoActions {
  connect: () => Promise<void>;
  disconnect: () => void;
  signPayload: (
    payload: Record<string, unknown>
  ) => Promise<{ signature: string; publicKey: string }>;
}

function albedoError(code: AlbedoErrorCode, message: string): AlbedoError {
  return { code, message };
}

function isPopupBlockedError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return (
      err.name === 'BlockedError' ||
      err.message?.toLowerCase().includes('popup') ||
      err.message?.toLowerCase().includes('blocked')
    );
  }
  if (err instanceof Error) {
    return (
      err.message?.toLowerCase().includes('popup') || err.message?.toLowerCase().includes('blocked')
    );
  }
  return false;
}

function isUserCancelledError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message?.toLowerCase() ?? '';
    return (
      msg.includes('cancel') ||
      msg.includes('rejected') ||
      msg.includes('denied') ||
      msg.includes('user')
    );
  }
  return false;
}

const WALLET_STORAGE_KEY = 'stellar-bounty-board-wallet';
const ALBEDO_PROVIDER = 'albedo';

export function useAlbedo(): AlbedoState & AlbedoActions {
  const [isConnected, setIsConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<AlbedoError | null>(null);
  const [connecting, setConnecting] = useState(false);
  const mountedRef = useRef(true);

  // Restore Albedo session from localStorage on mount
  useEffect(() => {
    mountedRef.current = true;

    try {
      const stored = localStorage.getItem(WALLET_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.provider === ALBEDO_PROVIDER && typeof parsed.publicKey === 'string') {
          setIsConnected(true);
          setPublicKey(parsed.publicKey);
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
    setConnecting(true);
    setError(null);

    try {
      const result = await albedo.publicKey({
        token: `bounty-board-${Date.now()}`,
      });

      if (!mountedRef.current) return;

      const pk = result.pubkey;
      setPublicKey(pk);
      setIsConnected(true);

      // Persist session
      try {
        localStorage.setItem(
          WALLET_STORAGE_KEY,
          JSON.stringify({ provider: ALBEDO_PROVIDER, publicKey: pk })
        );
      } catch {
        // ignore storage errors
      }
    } catch (err) {
      if (!mountedRef.current) return;

      if (isPopupBlockedError(err)) {
        setError(
          albedoError(
            'POPUP_BLOCKED',
            'Albedo popup was blocked by your browser. Please allow popups for this site and try again.'
          )
        );
      } else if (isUserCancelledError(err)) {
        setError(
          albedoError(
            'USER_CANCELLED',
            "Connection was cancelled. Please try again when you're ready."
          )
        );
      } else {
        setError(
          albedoError('CONNECTION_FAILED', 'Failed to connect to Albedo. Please try again.')
        );
      }
      setIsConnected(false);
      setPublicKey(null);
    } finally {
      if (mountedRef.current) {
        setConnecting(false);
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setPublicKey(null);
    setError(null);

    try {
      localStorage.removeItem(WALLET_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const signPayload = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!isConnected || !publicKey) {
        throw albedoError('CONNECTION_FAILED', 'Albedo wallet is not connected.');
      }

      try {
        const payloadStr = JSON.stringify(payload);

        const result = await albedo.signMessage({
          message: payloadStr,
          pubkey: publicKey,
        });

        return {
          signature: result.message_signature,
          publicKey: result.pubkey,
        };
      } catch (err) {
        if (isPopupBlockedError(err)) {
          throw albedoError(
            'POPUP_BLOCKED',
            'Albedo popup was blocked. Please allow popups and try again.'
          );
        }
        if (isUserCancelledError(err)) {
          throw albedoError('USER_CANCELLED', 'Signing was rejected in Albedo.');
        }
        throw albedoError(
          'SIGNING_FAILED',
          err instanceof Error ? err.message : 'Failed to sign payload with Albedo.'
        );
      }
    },
    [isConnected, publicKey]
  );

  return {
    isConnected,
    publicKey,
    error,
    connecting,
    connect,
    disconnect,
    signPayload,
  };
}
