import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import WalletButton from '../components/WalletButton';
import { WalletProvider } from '../context/WalletContext';

// Mock Freighter API
const mockFreighter = {
  connect: vi.fn(),
  getNetwork: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as any).freighter = mockFreighter;
});

describe('WalletButton', () => {
  it('shows Connect Wallet button when not connected', () => {
    render(
      <WalletProvider>
        <WalletButton />
      </WalletProvider>
    );

    expect(screen.getByText('Connect Wallet')).toBeDefined();
    expect(screen.getByLabelText('Connect Freighter wallet')).toBeDefined();
  });

  it('shows connected state with truncated address and network', async () => {
    mockFreighter.connect.mockResolvedValue({ address: 'GABCDEF123456789012345678901234567890123456789012345678901234567' });
    mockFreighter.getNetwork.mockResolvedValue('TESTNET');

    render(
      <WalletProvider>
        <WalletButton />
      </WalletProvider>
    );

    const connectButton = screen.getByText('Connect Wallet');
    fireEvent.click(connectButton);

    // Wait for async state update
    await screen.findByText(/G\.\.\.567/);

    expect(screen.getByText(/G\.\.\.567/)).toBeDefined();
    expect(screen.getByText('Testnet')).toBeDefined();
  });

  it('shows wrong network warning when on mainnet', async () => {
    mockFreighter.connect.mockResolvedValue({ address: 'GABCDEF123456789012345678901234567890123456789012345678901234567' });
    mockFreighter.getNetwork.mockResolvedValue('PUBLIC');

    render(
      <WalletProvider expectedNetwork="TESTNET">
        <WalletButton />
      </WalletProvider>
    );

    const connectButton = screen.getByText('Connect Wallet');
    fireEvent.click(connectButton);

    await screen.findByText(/G\.\.\.567/);

    expect(screen.getByText('Mainnet')).toBeDefined();
    // Check that the button has wrong network styling (border color red)
    const connectedButton = screen.getByLabelText(/Connected as/);
    expect(connectedButton.style.borderColor).toBe('rgb(239, 68, 68)');
  });

  it('shows disconnect option on hover', async () => {
    mockFreighter.connect.mockResolvedValue({ address: 'GABCDEF123456789012345678901234567890123456789012345678901234567' });
    mockFreighter.getNetwork.mockResolvedValue('TESTNET');

    render(
      <WalletProvider>
        <WalletButton />
      </WalletProvider>
    );

    const connectButton = screen.getByText('Connect Wallet');
    fireEvent.click(connectButton);

    await screen.findByText(/G\.\.\.567/);

    // Hover over the connected button
    const connectedButton = screen.getByLabelText(/Connected as/);
    fireEvent.mouseEnter(connectedButton);

    expect(screen.getByText('Disconnect')).toBeDefined();
    expect(screen.getByLabelText('Disconnect wallet')).toBeDefined();
  });

  it('disconnects when disconnect is clicked', async () => {
    mockFreighter.connect.mockResolvedValue({ address: 'GABCDEF123456789012345678901234567890123456789012345678901234567' });
    mockFreighter.getNetwork.mockResolvedValue('TESTNET');

    render(
      <WalletProvider>
        <WalletButton />
      </WalletProvider>
    );

    const connectButton = screen.getByText('Connect Wallet');
    fireEvent.click(connectButton);

    await screen.findByText(/G\.\.\.567/);

    // Hover and click disconnect
    const connectedButton = screen.getByLabelText(/Connected as/);
    fireEvent.mouseEnter(connectedButton);

    const disconnectButton = screen.getByText('Disconnect');
    fireEvent.click(disconnectButton);

    expect(screen.getByText('Connect Wallet')).toBeDefined();
  });

  it('is keyboard accessible', async () => {
    render(
      <WalletProvider>
        <WalletButton />
      </WalletProvider>
    );

    const connectButton = screen.getByText('Connect Wallet');
    connectButton.focus();
    expect(document.activeElement).toBe(connectButton);
  });
});
