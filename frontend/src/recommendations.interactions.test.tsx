import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import RecommendedBounties from './RecommendedBounties';
import type { BountyRecommendation } from './recommendations';
import type { Bounty } from './types';

const mockBounty: Bounty = {
  id: 'BNTY-INT-1',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 1290,
  title: 'Full interaction coverage for recommendations',
  summary: 'Verify user-event interactions on filters, empty views, and links.',
  maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  tokenSymbol: 'USDC',
  amount: 200,
  labels: [{ name: 'react', color: '61dafb' }],
  status: 'open',
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

const mockRecommendation: BountyRecommendation = {
  bounty: mockBounty,
  score: 0.9,
  reasons: ['Matches React skill', 'Top open bounty by reward'],
};

describe('recommendations user-event interactions (#1290)', () => {
  it('triggers onConnectWallet callback via user click', async () => {
    const user = userEvent.setup();
    const handleConnect = vi.fn();

    render(
      <RecommendedBounties
        recommendations={[]}
        walletConnected={false}
        onConnectWallet={handleConnect}
      />
    );

    const connectBtn = screen.getByRole('button', { name: /connect wallet/i });
    await user.click(connectBtn);

    expect(handleConnect).toHaveBeenCalledTimes(1);
  });

  it('filters recommendations and resets back to all via user clicks', async () => {
    const user = userEvent.setup();

    render(<RecommendedBounties recommendations={[mockRecommendation]} walletConnected={true} />);

    // Initial state: bounty card is visible
    expect(screen.getByText('Full interaction coverage for recommendations')).toBeInTheDocument();

    // Click Python filter chip
    const pythonChip = screen.getByRole('button', { name: /filter by python tag/i });
    await user.click(pythonChip);

    // Bounty card should no longer be rendered, empty state shown
    expect(
      screen.queryByText('Full interaction coverage for recommendations')
    ).not.toBeInTheDocument();
    expect(screen.getByText(/no recommended bounties match the python tag/i)).toBeInTheDocument();

    // Click 'Show all' button in empty state
    const showAllBtn = screen.getByRole('button', { name: /show all/i });
    await user.click(showAllBtn);

    // Bounty card restored
    expect(screen.getByText('Full interaction coverage for recommendations')).toBeInTheDocument();
  });

  it('targets DOM links and asserts valid target attributes without internal details', () => {
    render(<RecommendedBounties recommendations={[mockRecommendation]} walletConnected={true} />);

    const issueLink = screen.getByRole('link', {
      name: /view issue #1290 for full interaction coverage for recommendations/i,
    });
    expect(issueLink).toHaveAttribute('target', '_blank');
    expect(issueLink).toHaveAttribute(
      'href',
      'https://github.com/ritik4ever/stellar-bounty-board/issues/1290'
    );
  });
});
