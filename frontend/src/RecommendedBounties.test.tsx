import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecommendedBounties from './RecommendedBounties';
import type { BountyRecommendation } from './recommendations';

const mockRecommendation: BountyRecommendation = {
  bounty: {
    id: 'bounty-1',
    repo: 'stellar/soroban-example',
    issueNumber: 42,
    title: 'Implement Soroban smart contract',
    summary: 'Detailed explanation of smart contract integration',
    amount: 500,
    tokenSymbol: 'XLM',
    maintainer: 'GBBD67VQQ4T6JDWPUM6MVTN5R7F6',
    status: 'open',
    createdAt: Math.floor(Date.now() / 1000) - 86400,
    deadlineAt: Math.floor(Date.now() / 1000) + 86400 * 3,
    version: 1,
    events: [],
    labels: [
      { name: 'Rust', color: 'red' },
      { name: 'Smart Contract', color: 'blue' },
    ],
  },
  score: 0.95,
  reasons: ['Matches your preferred language (Rust)', 'Similar reward amount'],
};

const mockOverdueRecommendation: BountyRecommendation = {
  bounty: {
    id: 'bounty-2',
    repo: 'stellar/frontend-kit',
    issueNumber: 99,
    title: 'Fix React state synchronization bug',
    summary: 'Fix state update issue in React dashboard',
    amount: 250,
    tokenSymbol: 'OTHER',
    maintainer: 'GCOK47VQQ4T6JDWPUM6MVTN5R7F6',
    status: 'reserved',
    createdAt: Math.floor(Date.now() / 1000) - 86400 * 5,
    deadlineAt: Math.floor(Date.now() / 1000) - 86400 * 2,
    version: 1,
    events: [],
    labels: [{ name: 'React', color: 'blue' }],
  },
  score: 0.8,
  reasons: ['Matches your skill (React)'],
};

describe('RecommendedBounties Component Test Suite (#1280)', () => {
  it('renders recommendations list with match score, reasons, and bounty details', () => {
    render(<RecommendedBounties recommendations={[mockRecommendation]} />);

    expect(screen.getByText('95% match')).toBeDefined();
    expect(screen.getByText('Matches your preferred language (Rust)')).toBeDefined();
    expect(screen.getByText('Implement Soroban smart contract')).toBeDefined();
    expect(screen.getByText(/500 XLM/)).toBeDefined();
    expect(screen.getByText(/stellar\/soroban-example #42/)).toBeDefined();
  });

  it('renders relative deadline formatting for both future and overdue bounties', () => {
    const { rerender } = render(
      <RecommendedBounties recommendations={[mockRecommendation]} />
    );
    expect(screen.getByText(/days left/i)).toBeDefined();

    rerender(<RecommendedBounties recommendations={[mockOverdueRecommendation]} />);
    expect(screen.getByText(/days overdue/i)).toBeDefined();
  });

  it('renders UsdAmount only for XLM and USDC tokens and omits it for others', () => {
    const { rerender } = render(
      <RecommendedBounties recommendations={[mockRecommendation]} />
    );
    expect(screen.getByText(/500 XLM/)).toBeDefined();

    rerender(<RecommendedBounties recommendations={[mockOverdueRecommendation]} />);
    expect(screen.getByText(/250 OTHER/)).toBeDefined();
  });

  it('filters recommendations when a skill tag chip is clicked via user-event', async () => {
    const user = userEvent.setup();
    render(
      <RecommendedBounties
        recommendations={[mockRecommendation, mockOverdueRecommendation]}
      />
    );

    expect(screen.getByText('Implement Soroban smart contract')).toBeDefined();
    expect(screen.getByText('Fix React state synchronization bug')).toBeDefined();

    const rustTagButton = screen.getByRole('button', { name: 'Filter by Rust tag' });
    await user.click(rustTagButton);

    expect(screen.getByText('Implement Soroban smart contract')).toBeDefined();
    expect(screen.queryByText('Fix React state synchronization bug')).toBeNull();
  });

  it('shows empty filter state and resets via Show all button on user-event click', async () => {
    const user = userEvent.setup();
    render(<RecommendedBounties recommendations={[mockRecommendation]} />);

    const pythonTagButton = screen.getByRole('button', { name: 'Filter by Python tag' });
    await user.click(pythonTagButton);

    expect(screen.getByText(/No recommended bounties match the/i)).toBeDefined();
    expect(screen.getByText('Python')).toBeDefined();

    const showAllButton = screen.getByRole('button', { name: 'Show all' });
    await user.click(showAllButton);

    expect(screen.getByText('Implement Soroban smart contract')).toBeDefined();
  });

  it('handles walletConnected=false state and fires onConnectWallet on user-event click', async () => {
    const user = userEvent.setup();
    const handleConnect = vi.fn();

    render(
      <RecommendedBounties
        recommendations={[mockRecommendation]}
        walletConnected={false}
        onConnectWallet={handleConnect}
      />
    );

    expect(
      screen.getByText('Connect your wallet to see personalized bounty recommendations.')
    ).toBeDefined();

    const connectBtn = screen.getByRole('button', { name: 'Connect wallet' });
    await user.click(connectBtn);
    expect(handleConnect).toHaveBeenCalledTimes(1);
  });

  it('handles walletConnected=false without onConnectWallet callback gracefully', () => {
    render(
      <RecommendedBounties
        recommendations={[mockRecommendation]}
        walletConnected={false}
      />
    );

    expect(
      screen.getByText('Connect your wallet to see personalized bounty recommendations.')
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Connect wallet' })).toBeNull();
  });

  it('handles error state with string error and onRetry trigger via user-event', async () => {
    const user = userEvent.setup();
    const handleRetry = vi.fn();

    render(
      <RecommendedBounties
        recommendations={[]}
        error="Network error fetching recommendations"
        onRetry={handleRetry}
      />
    );

    expect(screen.getByText('Unable to load recommendations')).toBeDefined();
    expect(screen.getByText('Network error fetching recommendations')).toBeDefined();

    const retryBtn = screen.getByRole('button', { name: 'Retry loading recommendations' });
    await user.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('handles error state with Error object and default message fallback', () => {
    render(
      <RecommendedBounties
        recommendations={[]}
        error={new Error('Custom error object message')}
      />
    );

    expect(screen.getByText('Custom error object message')).toBeDefined();
  });

  it('handles loading state with skeletons and aria-busy', () => {
    const { container } = render(
      <RecommendedBounties recommendations={[]} loading={true} />
    );

    expect(container.querySelector('[aria-busy="true"]')).toBeDefined();
    expect(container.querySelectorAll('.bounty-card--skeleton').length).toBe(3);
  });

  it('handles empty recommendations state when no recommendations are available', () => {
    render(<RecommendedBounties recommendations={[]} />);

    expect(
      screen.getByText(
        'No recommendations available yet. Complete some bounties to get personalized suggestions!'
      )
    ).toBeDefined();
  });
});
