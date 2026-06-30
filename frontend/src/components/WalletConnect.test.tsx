import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WalletProvider } from '../context/WalletContext';
import { WalletConnect } from './WalletConnect';
import * as freighter from '@stellar/freighter-api';

// Mock the freighter API
vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  getPublicKey: vi.fn(),
  getNetwork: vi.fn(),
}));

describe('WalletConnect & WalletContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderComponent = () => {
    return render(
      <WalletProvider>
        <WalletConnect />
      </WalletProvider>
    );
  };

  it('renders "Connect Wallet" button when disconnected', () => {
    renderComponent();
    expect(screen.getByRole('button', { name: /Connect Freighter Wallet/i })).toBeInTheDocument();
  });

  it('connects successfully and displays connected pill on Testnet', async () => {
    vi.mocked(freighter.isConnected).mockResolvedValue(true);
    vi.mocked(freighter.getPublicKey).mockResolvedValue('GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK');
    vi.mocked(freighter.getNetwork).mockResolvedValue('TESTNET');

    renderComponent();

    const connectBtn = screen.getByRole('button', { name: /Connect Freighter Wallet/i });
    
    await act(async () => {
      fireEvent.click(connectBtn);
    });

    // Verify localStorage persistence
    expect(localStorage.getItem('freighter_address')).toBe('GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK');

    // Should display connected state address and network
    expect(screen.getByText('GB5IWB...OOK')).toBeInTheDocument();
    expect(screen.getByText(/Testnet/i)).toBeInTheDocument();
  });

  it('shows wrong-network warning badge when on Mainnet (PUBLIC)', async () => {
    vi.mocked(freighter.isConnected).mockResolvedValue(true);
    vi.mocked(freighter.getPublicKey).mockResolvedValue('GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK');
    // Mainnet network is returned as 'PUBLIC'
    vi.mocked(freighter.getNetwork).mockResolvedValue('PUBLIC');

    renderComponent();

    const connectBtn = screen.getByRole('button', { name: /Connect Freighter Wallet/i });
    
    await act(async () => {
      fireEvent.click(connectBtn);
    });

    // Check warning badge is visible
    expect(screen.getByText('Mainnet! Use Testnet')).toBeInTheDocument();
  });

  it('disconnects and updates UI on click', async () => {
    vi.mocked(freighter.isConnected).mockResolvedValue(true);
    vi.mocked(freighter.getPublicKey).mockResolvedValue('GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK');
    vi.mocked(freighter.getNetwork).mockResolvedValue('TESTNET');

    renderComponent();

    // Connect first
    const connectBtn = screen.getByRole('button', { name: /Connect Freighter Wallet/i });
    await act(async () => {
      fireEvent.click(connectBtn);
    });

    const connectedPill = screen.getByRole('button', { name: /Connected as/i });
    expect(connectedPill).toBeInTheDocument();

    // Click connected pill to disconnect
    await act(async () => {
      fireEvent.click(connectedPill);
    });

    // Verify localStorage cleared and Connect Wallet button is back
    expect(localStorage.getItem('freighter_address')).toBeNull();
    expect(screen.getByRole('button', { name: /Connect Freighter Wallet/i })).toBeInTheDocument();
  });
});
