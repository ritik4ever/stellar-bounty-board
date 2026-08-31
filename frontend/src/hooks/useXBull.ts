/**
 * useXBull – React hook for interacting with the xBull Stellar wallet extension.
 *
 * The xBull extension injects `window.xBullSDK` into every page. This hook
 * communicates with that injected SDK directly – no npm package is required.
 *
 * Shape mirrors `useFreighter` so both hooks can be consumed by a single
 * `WalletSelector` component and the shared `useWallet` hook.
 *
 * Provides:
 *  - Connection state (isConnected, publicKey)
 *  - connect() / disconnect() lifecycle
 *  - signPayload() for signing canonical request payload objects
 *  - Error state with typed error codes
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Window augmentation – the xBull extension injects `window.xBullSDK`
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    xBullSDK?: {
      getAddress: () => Promise<{ address: string }>;
      signMessage: (
        message: string,
        opts?: { networkPassphrase?: string; address?: string }
      ) => Promise<{ signedMessage: string; signerAddress: string }>;
    };
  }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------
export type XBullErrorCode = 'NO_XBULL' | 'NOT_CONNECTED' | 'USER_REJECTED' | 'SIGNING_FAILED';

export interface XBullError {
  code: XBullErrorCode;
  message: string;
}

export interface XBullState {
  isConnected: boolean;
  publicKey: string | null;
  error: XBullError | null;
  connecting: boolean;
}

export interface XBullActions {
  connect: () => Promise<void>;
  disconnect: () => void;
  signPayload: (
    payload: Record<string, unknown>
  ) => Promise<{ signature: string; publicKey: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function xBullError(code: XBullErrorCode, message: string): XBullError {
  return { code, message };
}

export function isXBullInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.xBullSDK;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useXBull(): XBullState & XBullActions {
  const [isConnected, setIsConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<XBullError | null>(null);
  const [connecting, setConnecting] = useState(false);
  const mountedRef = useRef(true);

  // Detect install status on mount and set initial error if not found
  useEffect(() => {
    mountedRef.current = true;

    if (!isXBullInstalled()) {
      setError(
        xBullError(
          'NO_XBULL',
          'xBull wallet is not installed. Please install the xBull browser extension.'
        )
      );
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);

    try {
      if (!isXBullInstalled()) {
        throw xBullError(
          'NO_XBULL',
          'xBull wallet is not installed. Please install the xBull browser extension from https://xbull.app'
        );
      }

      const response = await window.xBullSDK!.getAddress();
      const address = response?.address;

      if (!address) {
        throw xBullError('NOT_CONNECTED', 'xBull did not return a public key.');
      }

      if (mountedRef.current) {
        setPublicKey(address);
        setIsConnected(true);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        // Distinguish typed XBullErrors from raw extension errors
        if (err && typeof err === 'object' && 'code' in err) {
          setError(err as XBullError);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          const isRejection =
            msg.toLowerCase().includes('reject') ||
            msg.toLowerCase().includes('cancel') ||
            msg.toLowerCase().includes('denied');

          setError(
            isRejection
              ? xBullError('USER_REJECTED', 'Connection request was rejected in xBull.')
              : xBullError('NOT_CONNECTED', msg || 'Failed to connect to xBull wallet.')
          );
        }
        setIsConnected(false);
        setPublicKey(null);
      }
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
  }, []);

  const signPayload = useCallback(
    async (payload: Record<string, unknown>): Promise<{ signature: string; publicKey: string }> => {
      if (!isXBullInstalled()) {
        throw xBullError('NO_XBULL', 'xBull wallet is not installed.');
      }

      if (!isConnected || !publicKey) {
        throw xBullError('NOT_CONNECTED', 'xBull wallet is not connected.');
      }

      try {
        const payloadStr = JSON.stringify(payload);
        const response = await window.xBullSDK!.signMessage(payloadStr);
        return {
          signature: response.signedMessage,
          publicKey: response.signerAddress,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isRejection =
          msg.toLowerCase().includes('reject') ||
          msg.toLowerCase().includes('cancel') ||
          msg.toLowerCase().includes('denied');

        if (isRejection) {
          throw xBullError('USER_REJECTED', 'Signing was rejected in xBull.');
        }
        throw xBullError('SIGNING_FAILED', msg || 'Failed to sign payload with xBull.');
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
