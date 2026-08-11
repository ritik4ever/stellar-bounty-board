import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useWallet } from '../hooks/useWallet';
import { getRecommendedBounties } from '../lib/recommendations';
import RecommendedBounties from './RecommendedBounties';
import type { Bounty } from '../types';

// Mock dependencies
jest.mock('../hooks/useWallet');
jest.mock('../lib/recommendations');

const mockUseWallet = useWallet as jest.MockedFunction<typeof useWallet>;
const mockGetRecommendedBounties = getRecommendedBounties as jest.MockedFunction<
  typeof getRecommendedBounties
>;

describe('RecommendedBounties', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows empty state when wallet is not connected', () => {
    mockUseWallet.mockReturnValue({
      walletAddress: null,
      isConnected: false,
    });

    render(<RecommendedBounties />);

    expect(
      screen.getByText('Connect your wallet to see personalized bounty recommendations.')
    ).toBeInTheDocument();
  });

  it('shows loading state while fetching recommendations', () => {
    mockUseWallet.mockReturnValue({
      walletAddress: '0x123',
      isConnected: true,
    });
    mockGetRecommendedBounties.mockReturnValue(new Promise(() => {})); // Never resolves

    render(<RecommendedBounties />);

    expect(screen.getByText('Recommended Bounties')).toBeInTheDocument();
    expect(document.querySelector('.spinner')).toBeInTheDocument();
  });

  it('shows empty state when no recommendations are returned', async () => {
    mockUseWallet.mockReturnValue({
      walletAddress: '0x123',
      isConnected: true,
    });
    mockGetRecommendedBounties.mockResolvedValue([]);

    render(<RecommendedBounties />);

    await waitFor(() => {
      expect(
        screen.getByText('No recommendations available at this time.')
      ).toBeInTheDocument();
    });
  });

  it('displays up to 3 recommended bounties', async () => {
    const mockBounties: Bounty[] = [
      { id: '1', title: 'Bounty 1', value: 100, status: 'open', labels: ['react'] },
      { id: '2', title: 'Bounty 2', value: 200, status: 'open', labels: ['python'] },
      { id: '3', title: 'Bounty 3', value: 300, status: 'open', labels: ['rust'] },
    ];

    mockUseWallet.mockReturnValue({
      walletAddress: '0x123',
      isConnected: true,
    });
    mockGetRecommendedBounties.mockResolvedValue(mockBounties);

    render(<RecommendedBounties />);

    await waitFor(() => {
      expect(screen.getByText('Bounty 1')).toBeInTheDocument();
      expect(screen.getByText('Bounty 2')).toBeInTheDocument();
      expect(screen.getByText('Bounty 3')).toBeInTheDocument();
    });
  });

  it('limits display to 3 bounties even if more are returned', async () => {
    const mockBounties: Bounty[] = [
      { id: '1', title: 'Bounty 1', value: 100, status: 'open', labels: [] },
      { id: '2', title: 'Bounty 2', value: 200, status: 'open', labels: [] },
      { id: '3', title: 'Bounty 3', value: 300, status: 'open', labels: [] },
      { id: '4', title: 'Bounty 4', value: 400, status: 'open', labels: [] },
    ];

    mockUseWallet.mockReturnValue({
      walletAddress: '0x123',
      isConnected: true,
    });
    mockGetRecommendedBounties.mockResolvedValue(mockBounties);

    render(<RecommendedBounties />);

    await waitFor(() => {
      expect(screen.getByText('Bounty 1')).toBeInTheDocument();
      expect(screen.getByText('Bounty 2')).toBeInTheDocument();
      expect(screen.getByText('Bounty 3')).toBeInTheDocument();
      expect(screen.queryByText('Bounty 4')).not.toBeInTheDocument();
    });
  });
});
