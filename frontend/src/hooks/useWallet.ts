/**
 * useWallet – unified wallet hook that wraps both Freighter and xBull.
 *
 * Consumers (e.g. WalletSelector) call `setWalletType` to choose which wallet
 * to use.  `connect` / `disconnect` / `signPayload` then delegate to the
 * active connector.
 *
 * If neither wallet is installed, `availableWallets` will be empty and the
 * UI can show install prompts accordingly.
 */

import { useCallback, useMemo } from 'react';
import { useFreighter } from './useFreighter';
import { useXBull, isXBullInstalled } from './useXBull';
import { useLocalStorage } from './useLocalStorage';
import { isFreighterInstalled } from './useFreighter';

export type WalletType = 'freighter' | 'xbull';

const WALLET_TYPE_KEY = 'stellar-bounty-board-wallet-type';

export interface WalletState {
  /** The currently active wallet type chosen by the user, or null if none. */
  activeWallet: WalletType | null;
  /** Wallet types that are actually installed in the browser. */
  availableWallets: WalletType[];
  /** The connected public key, regardless of which wallet provided it. */
  publicKey: string | null;
  isConnected: boolean;
  connecting: boolean;
  /** Unified error message string (null when no error). */
  errorMessage: string | null;
  /** Switch the active wallet type (does not connect – call connect() after). */
  setActiveWallet: (type: WalletType) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  signPayload: (
    payload: Record<string, unknown>
  ) => Promise<{ signature: string; publicKey: string }>;
}

export function useWallet(): WalletState {
  const freighter = useFreighter();
  const xbull = useXBull();

  const [activeWallet, setActiveWallet] = useLocalStorage<WalletType | null>(WALLET_TYPE_KEY, null);

  const availableWallets = useMemo<WalletType[]>(() => {
    const wallets: WalletType[] = [];
    if (isFreighterInstalled()) wallets.push('freighter');
    if (isXBullInstalled()) wallets.push('xbull');
    return wallets;
  }, []);

  const active = activeWallet ?? availableWallets[0] ?? null;

  const connector = active === 'xbull' ? xbull : freighter;

  const connect = useCallback(async () => {
    await connector.connect();
  }, [connector]);

  const disconnect = useCallback(() => {
    connector.disconnect();
  }, [connector]);

  const signPayload = useCallback(
    (payload: Record<string, unknown>) => connector.signPayload(payload),
    [connector]
  );

  return {
    activeWallet: active,
    availableWallets,
    publicKey: connector.publicKey,
    isConnected: connector.isConnected,
    connecting: connector.connecting,
    errorMessage: connector.error?.message ?? null,
    setActiveWallet,
    connect,
    disconnect,
    signPayload,
  };
}
