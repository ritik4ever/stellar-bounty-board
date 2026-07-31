import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ContributorDashboard from './ContributorDashboard';
import type { Bounty } from './types';

const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const openBounties: Bounty[] = [
  {
    id: 'open-high',
    repo: 'owner/repo',
    issueNumber: 1,
    title: 'High reward task',
    summary: 'Big payout',
    maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    tokenSymbol: 'XLM',
    amount: 500,
    labels: [{ name: 'docs', color: '111111' }],
    status: 'open',
    createdAt: 0,
    deadlineAt: 9_999_999_999,
    version: 1,
    events: [],
  },
  {
    id: 'open-low',
    repo: 'owner/repo',
    issueNumber: 2,
    title: 'Low reward task',
    summary: 'Small payout',
    maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    tokenSymbol: 'XLM',
    amount: 50,
    labels: [{ name: 'react', color: '222222' }],
    status: 'open',
    createdAt: 0,
    deadlineAt: 9_999_999_999,
    version: 1,
    events: [],
  },
];

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('ContributorDashboard', () => {
  it('shows wallet connect empty state when wallet is not connected', () => {
    render(<ContributorDashboard bounties={openBounties} loading={false} />);

    expect(
      screen.getByText(/connect your wallet to see personalized bounty recommendations/i)
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /connect wallet/i }).length).toBeGreaterThan(0);
  });

  it('shows fallback recommendations for a connected wallet with no history', async () => {
    window.localStorage.setItem('stellar-bounty-board-wallet', JSON.stringify(WALLET));

    render(<ContributorDashboard bounties={openBounties} loading={false} />);

    await waitFor(() => {
      expect(screen.getByText('High reward task')).toBeInTheDocument();
    });

    expect(screen.getByText('Low reward task')).toBeInTheDocument();
    expect(screen.getAllByText(/recommended bounties/i).length).toBeGreaterThan(0);
  });

  it('shows label-based recommendations for completed contributor work', async () => {
    window.localStorage.setItem('stellar-bounty-board-wallet', JSON.stringify(WALLET));

    const bounties: Bounty[] = [
      ...openBounties,
      {
        id: 'done-react',
        repo: 'owner/repo',
        issueNumber: 3,
        title: 'Completed React bounty',
        summary: 'Done',
        maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        contributor: WALLET,
        tokenSymbol: 'XLM',
        amount: 100,
        labels: [{ name: 'react', color: '61dafb' }],
        status: 'released',
        createdAt: 0,
        deadlineAt: 9_999_999_999,
        version: 1,
        events: [],
      },
    ];

    render(<ContributorDashboard bounties={bounties} loading={false} />);

    await waitFor(() => {
      expect(screen.getByText('Low reward task')).toBeInTheDocument();
    });

    expect(screen.queryByText('High reward task')).not.toBeInTheDocument();
    expect(screen.getByText(/matches 1 label/i)).toBeInTheDocument();
  });

  it('prompts to connect when the connect wallet button is clicked', async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(WALLET);
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<ContributorDashboard bounties={openBounties} loading={false} />);

    await user.click(screen.getAllByRole('button', { name: /connect wallet/i })[0]!);

    expect(promptSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('High reward task')).toBeInTheDocument();
    });
  });
});
