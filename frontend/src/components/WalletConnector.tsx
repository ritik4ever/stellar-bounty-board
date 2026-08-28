/**
 * WalletConnector – A unified wallet connection component.
 *
 * Provides:
 *  - A normalized hook interface for Freighter and Albedo wallets
 *  - Error state normalization across both wallet types
 *  - A single connect/disconnect/sign API consumed by App.tsx
 *
 * The parent component is responsible for rendering all UI.
 */

import { useCallback } from 'react';
import { useFreighter, type FreighterError } from '../hooks/useFreighter';
import { useAlbedo, type AlbedoError } from '../hooks/useAlbedo';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type WalletType = 'freighter' | 'albedo';

export interface WalletError {
  code: string;
  message: string;
}

export interface NormalizedWalletState {
  isConnected: boolean;
  publicKey: string | null;
  walletType: WalletType | null;
  isOnCorrectNetwork: boolean;
  error: WalletError | null;
  connecting: boolean;
}

export interface NormalizedWalletActions {
  connect: (type: WalletType) => Promise<void>;
  disconnect: () => void;
  signPayload: (
    payload: Record<string, unknown>
  ) => Promise<{ signature: string; publicKey: string }>;
}

export type NormalizedWallet = NormalizedWalletState & NormalizedWalletActions;

interface WalletConnectorProps {
  /** Render the wallet state + actions. The parent is responsible for all UI. */
  children: (wallet: NormalizedWallet) => React.ReactNode;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function freighterErrorToWalletError(e: FreighterError): WalletError {
  return { code: e.code, message: e.message };
}

function albedoErrorToWalletError(e: AlbedoError): WalletError {
  return { code: e.code, message: e.message };
}

/* -------------------------------------------------------------------------- */
/*  WalletConnector component                                                  */
/* -------------------------------------------------------------------------- */

export function WalletConnector({ children }: WalletConnectorProps) {
  const freighter = useFreighter();
  const albedo = useAlbedo();

  // Determine which wallet is active based on connection state.
  const activeWalletType: WalletType | null = freighter.isConnected
    ? 'freighter'
    : albedo.isConnected
      ? 'albedo'
      : null;

  // Build the unified error (use the error from whichever wallet is active)
  const rawError: WalletError | null =
    activeWalletType === 'freighter' && freighter.error
      ? freighterErrorToWalletError(freighter.error)
      : activeWalletType === 'albedo' && albedo.error
        ? albedoErrorToWalletError(albedo.error)
        : null;

  const isConnecting = freighter.connecting || albedo.connecting;

  const connect = useCallback(
    async (type: WalletType) => {
      if (type === 'freighter') {
        await freighter.connect();
      } else {
        await albedo.connect();
      }
    },
    [freighter.connect, albedo.connect]
  );

  const disconnect = useCallback(() => {
    if (freighter.isConnected) freighter.disconnect();
    if (albedo.isConnected) albedo.disconnect();
  }, [freighter, albedo]);

  const signPayload = useCallback(
    async (payload: Record<string, unknown>) => {
      if (freighter.isConnected) {
        return freighter.signPayload(payload);
      }
      if (albedo.isConnected) {
        return albedo.signPayload(payload);
      }
      throw new Error('No wallet connected.');
    },
    [freighter, albedo]
  );

  const normalized: NormalizedWallet = {
    isConnected: freighter.isConnected || albedo.isConnected,
    publicKey: freighter.publicKey ?? albedo.publicKey,
    walletType: activeWalletType,
    // Albedo doesn't expose network info; treat it as always correct
    // since Albedo handles network selection internally.
    isOnCorrectNetwork: activeWalletType === 'freighter' ? freighter.isOnCorrectNetwork : true,
    error: rawError,
    connecting: isConnecting,
    connect,
    disconnect,
    signPayload,
  };

  return <>{children(normalized)}</>;
}
