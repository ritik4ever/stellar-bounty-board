import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WalletSelector from './WalletSelector';
import type { WalletState } from '../hooks/useWallet';

// ---------------------------------------------------------------------------
// Mock window globals for wallet detection
// ---------------------------------------------------------------------------
function installFreighter() {
  (window as any).freighter = {
    isConnected: vi.fn().mockResolvedValue({ isConnected: false }),
    getPublicKey: vi.fn(),
    signMessage: vi.fn(),
    getNetwork: vi.fn(),
    setNetwork: vi.fn(),
  };
}

function uninstallFreighter() {
  delete (window as any).freighter;
}

function installXBull() {
  (window as any).xBullSDK = {
    getAddress: vi.fn().mockResolvedValue({ address: 'GBULLTEST' }),
    signMessage: vi.fn(),
  };
}

function uninstallXBull() {
  delete (window as any).xBullSDK;
}

// ---------------------------------------------------------------------------
// Helper: build a minimal WalletState mock
// ---------------------------------------------------------------------------
function makeWallet(overrides: Partial<WalletState> = {}): WalletState {
  return {
    activeWallet: null,
    availableWallets: [],
    publicKey: null,
    isConnected: false,
    connecting: false,
    errorMessage: null,
    setActiveWallet: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    signPayload: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('WalletSelector – no wallets installed', () => {
  beforeEach(() => {
    uninstallFreighter();
    uninstallXBull();
  });

  it('shows install prompts for both wallets', () => {
    const wallet = makeWallet();
    render(<WalletSelector wallet={wallet} />);

    expect(screen.getByRole('link', { name: /install freighter/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /install xbull/i })).toBeInTheDocument();
  });

  it('install prompt for xBull points to xbull.app', () => {
    const wallet = makeWallet();
    render(<WalletSelector wallet={wallet} />);
    const link = screen.getByRole('link', { name: /install xbull/i });
    expect(link).toHaveAttribute('href', 'https://xbull.app');
  });

  it('install prompt for Freighter points to freighter.app', () => {
    const wallet = makeWallet();
    render(<WalletSelector wallet={wallet} />);
    const link = screen.getByRole('link', { name: /install freighter/i });
    expect(link).toHaveAttribute('href', 'https://freighter.app');
  });
});

describe('WalletSelector – both wallets installed, not connected', () => {
  beforeEach(() => {
    installFreighter();
    installXBull();
  });

  afterEach(() => {
    uninstallFreighter();
    uninstallXBull();
  });

  it('shows connect buttons for both wallets', () => {
    const wallet = makeWallet({ availableWallets: ['freighter', 'xbull'] });
    render(<WalletSelector wallet={wallet} />);

    expect(screen.getByRole('button', { name: /connect freighter/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect xbull/i })).toBeInTheDocument();
  });

  it("clicking Connect xBull calls setActiveWallet('xbull') and connect()", async () => {
    const wallet = makeWallet({ availableWallets: ['freighter', 'xbull'] });
    render(<WalletSelector wallet={wallet} />);

    const btn = screen.getByRole('button', { name: /connect xbull/i });
    fireEvent.click(btn);

    expect(wallet.setActiveWallet).toHaveBeenCalledWith('xbull');
    // connect is async, wait a tick
    await Promise.resolve();
    expect(wallet.connect).toHaveBeenCalledOnce();
  });
});

describe('WalletSelector – xBull connected', () => {
  beforeEach(() => {
    installXBull();
    uninstallFreighter();
  });

  afterEach(() => {
    uninstallXBull();
  });

  it('shows truncated public key and disconnect button when xBull is connected', () => {
    const wallet = makeWallet({
      activeWallet: 'xbull',
      availableWallets: ['xbull'],
      isConnected: true,
      publicKey: 'GBULLPUBLICKEY1234567890ABCDEFGHIJK',
    });
    render(<WalletSelector wallet={wallet} />);

    // shortAddress slices 6 from start and 4 from end:
    // "GBULLP...HIJK"
    expect(screen.getByText('GBULLP...HIJK')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect xbull/i })).toBeInTheDocument();
  });

  it('clicking disconnect calls wallet.disconnect()', () => {
    const wallet = makeWallet({
      activeWallet: 'xbull',
      availableWallets: ['xbull'],
      isConnected: true,
      publicKey: 'GBULLPUBLICKEY1234567890ABCDEFGHIJK',
    });
    render(<WalletSelector wallet={wallet} />);

    const btn = screen.getByRole('button', { name: /disconnect xbull/i });
    fireEvent.click(btn);
    expect(wallet.disconnect).toHaveBeenCalledOnce();
  });
});

describe('WalletSelector – error banner', () => {
  beforeEach(() => {
    uninstallFreighter();
    uninstallXBull();
  });

  it('shows error message when errorMessage is set and compact=false', () => {
    const wallet = makeWallet({
      errorMessage: 'xBull wallet is not installed. Please install the xBull browser extension.',
    });
    render(<WalletSelector wallet={wallet} compact={false} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/xBull wallet is not installed/i);
  });

  it('includes install link in error banner for xBull not installed', () => {
    const wallet = makeWallet({
      errorMessage: 'xBull wallet is not installed. Please install the xBull browser extension.',
    });
    render(<WalletSelector wallet={wallet} compact={false} />);
    // There are two links with this label: the install prompt button AND the error banner link.
    // We verify the error banner link specifically (the one inside role="alert").
    const alert = screen.getByRole('alert');
    const link = within(alert).getByRole('link', { name: /install xbull wallet extension/i });
    expect(link).toHaveAttribute('href', 'https://xbull.app');
  });

  it('hides error banner in compact mode', () => {
    const wallet = makeWallet({
      errorMessage: 'xBull wallet is not installed.',
    });
    render(<WalletSelector wallet={wallet} compact />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
