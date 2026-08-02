/**
 * useFreighter – React hook for interacting with the Freighter Stellar wallet.
 *
 * Provides:
 *  - Connection state (isConnected, publicKey)
 *  - Network detection (isOnCorrectNetwork)
 *  - signPayload() for signing canonical request payload objects
 *  - connect() / disconnect() lifecycle
 *  - Error state for disconnection / wrong network
 */

import { useState, useEffect, useCallback, useRef } from "react";

declare global {
  interface Window {
    freighter?: {
      isConnected: () => Promise<{ isConnected: boolean }>;
      getPublicKey: () => Promise<string>;
      signMessage: (
        message: string,
        opts?: { networkPassphrase?: string }
      ) => Promise<{ signature: string }>;
      getNetwork: () => Promise<{
        network: string;
        networkPassphrase: string;
      }>;
      setNetwork: (network: string, opts?: { networkPassphrase?: string }) => Promise<void>;
    };
  }
}

export const STELLAR_NETWORK_PASSPHRASE =
  import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015";

export const STELLAR_NETWORK =
  import.meta.env.VITE_STELLAR_NETWORK ?? "TESTNET";

export type FreighterErrorCode =
  | "NO_FREIGHTER"
  | "NOT_CONNECTED"
  | "WRONG_NETWORK"
  | "USER_REJECTED"
  | "SIGNING_FAILED";

export interface FreighterError {
  code: FreighterErrorCode;
  message: string;
}

export interface FreighterState {
  isConnected: boolean;
  publicKey: string | null;
  isOnCorrectNetwork: boolean;
  error: FreighterError | null;
  connecting: boolean;
}

export interface FreighterActions {
  connect: () => Promise<void>;
  disconnect: () => void;
  signPayload: (payload: Record<string, unknown>) => Promise<{ signature: string; publicKey: string }>;
}

function freighterError(code: FreighterErrorCode, message: string): FreighterError {
  return { code, message };
}

function isFreighterInstalled(): boolean {
  return typeof window !== "undefined" && !!window.freighter;
}

async function ensureConnected(): Promise<string> {
  if (!isFreighterInstalled()) {
    throw freighterError("NO_FREIGHTER", "Freighter wallet is not installed. Please install the Freighter browser extension.");
  }

  const { isConnected } = await window.freighter!.isConnected();
  if (!isConnected) {
    throw freighterError("NOT_CONNECTED", "Freighter wallet is not connected. Please unlock Freighter and allow this site.");
  }

  const publicKey = await window.freighter!.getPublicKey();
  return publicKey;
}

async function checkNetwork(): Promise<boolean> {
  if (!isFreighterInstalled()) return false;

  try {
    const { networkPassphrase } = await window.freighter!.getNetwork();
    return networkPassphrase === STELLAR_NETWORK_PASSPHRASE;
  } catch {
    return false;
  }
}

export function useFreighter(): FreighterState & FreighterActions {
  const [isConnected, setIsConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isOnCorrectNetwork, setIsOnCorrectNetwork] = useState(false);
  const [error, setError] = useState<FreighterError | null>(null);
  const [connecting, setConnecting] = useState(false);
  const mountedRef = useRef(true);

  // Check initial state on mount
  useEffect(() => {
    mountedRef.current = true;

    async function init() {
      if (!isFreighterInstalled()) {
        if (mountedRef.current) {
          setError(freighterError("NO_FREIGHTER", "Freighter wallet is not installed."));
        }
        return;
      }

      try {
        const { isConnected: connected } = await window.freighter!.isConnected();
        if (!mountedRef.current) return;

        setIsConnected(connected);

        if (connected) {
          const pk = await window.freighter!.getPublicKey();
          if (mountedRef.current) {
            setPublicKey(pk);
          }

          const correct = await checkNetwork();
          if (mountedRef.current) {
            setIsOnCorrectNetwork(correct);
            if (!correct) {
              setError(
                freighterError(
                  "WRONG_NETWORK",
                  `Wrong network. Please switch to ${STELLAR_NETWORK} in Freighter.`
                )
              );
            } else {
              setError(null);
            }
          }
        }
      } catch (err) {
        if (mountedRef.current) {
          console.warn("[useFreighter] Initialisation error:", err);
        }
      }
    }

    void init();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);

    try {
      if (!isFreighterInstalled()) {
        throw freighterError("NO_FREIGHTER", "Freighter wallet is not installed. Please install the Freighter browser extension.");
      }

      // Request access – this will prompt the user if needed
      const pk = await ensureConnected();
      if (!mountedRef.current) return;

      setPublicKey(pk);
      setIsConnected(true);

      const correct = await checkNetwork();
      if (mountedRef.current) {
        setIsOnCorrectNetwork(correct);
        if (!correct) {
          setError(
            freighterError(
              "WRONG_NETWORK",
              `Wrong network. Please switch to ${STELLAR_NETWORK} in Freighter.`
            )
          );
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        const fErr = err as FreighterError;
        setError(fErr);
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
    setIsOnCorrectNetwork(false);
    setError(null);
  }, []);

  const signPayload = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!isFreighterInstalled()) {
        throw freighterError("NO_FREIGHTER", "Freighter wallet is not installed.");
      }

      if (!isConnected || !publicKey) {
        throw freighterError("NOT_CONNECTED", "Freighter wallet is not connected.");
      }

      if (!isOnCorrectNetwork) {
        throw freighterError(
          "WRONG_NETWORK",
          `Wrong network. Please switch to ${STELLAR_NETWORK} in Freighter.`
        );
      }

      try {
        // Create the canonical payload string: JSON.stringify({ bountyId, action, timestamp })
        const payloadStr = JSON.stringify(payload);

        // Sign with Freighter
        const { signature } = await window.freighter!.signMessage(payloadStr, {
          networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        });

        return { signature, publicKey };
      } catch (err: any) {
        if (err?.code === 4 || err?.message?.includes("reject") || err?.message?.includes("cancel")) {
          throw freighterError("USER_REJECTED", "Signing was rejected in Freighter.");
        }
        throw freighterError("SIGNING_FAILED", err?.message ?? "Failed to sign payload with Freighter.");
      }
    },
    [isConnected, publicKey, isOnCorrectNetwork]
  );

  return {
    isConnected,
    publicKey,
    isOnCorrectNetwork,
    error,
    connecting,
    connect,
    disconnect,
    signPayload,
  };
}
