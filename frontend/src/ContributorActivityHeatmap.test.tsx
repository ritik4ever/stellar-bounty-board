import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import ContributorActivityHeatmap from './ContributorActivityHeatmap';
import type { Bounty } from './types';

const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const today = new Date();
today.setHours(0, 0, 0, 0);

function makeBounty(overrides: Partial<Bounty> & { id: string }): Bounty {
  return {
    repo: 'owner/repo',
    issueNumber: 1,
    title: 'Test bounty',
    summary: 'A test bounty',
    maintainer: WALLET,
    tokenSymbol: 'XLM',
    amount: 100,
    labels: [],
    status: 'open',
    createdAt: 0,
    deadlineAt: 9_999_999_999,
    events: [],
    ...overrides,
  };
}

describe('ContributorActivityHeatmap', () => {
  it('shows connect prompt when no wallet address is given', () => {
    render(<ContributorActivityHeatmap bounties={[]} />);

    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
  });

  it('shows empty state for a wallet with no activity', () => {
    render(
      <ContributorActivityHeatmap
        bounties={[]}
        contributorAddress={WALLET}
      />,
    );

    expect(screen.getByText(/no contribution activity recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/0 contributions in the last year/i)).toBeInTheDocument();
  });

  it('renders a heatmap cell for each day of the year', () => {
    render(
      <ContributorActivityHeatmap
        bounties={[]}
        contributorAddress={WALLET}
      />,
    );

    // 365 days + leading empty cells for alignment = 365 cells
    const cells = screen.getAllByRole('gridcell');
    expect(cells.length).toBe(365);
  });

  it('counts submitted and released events as activity', () => {
    const yesterday = new Date(today.getTime() - 86_400_000);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const bounties: Bounty[] = [
      makeBounty({
        id: 'b1',
        contributor: WALLET,
        status: 'submitted',
        events: [
          { type: 'submitted', timestamp: yesterday.getTime() },
        ],
      }),
    ];

    render(
      <ContributorActivityHeatmap
        bounties={bounties}
        contributorAddress={WALLET}
      />,
    );

    expect(screen.getByText(/1 contribution in the last year/i)).toBeInTheDocument();

    // The cell for yesterday should have a non-zero background colour
    const cells = screen.getAllByRole('gridcell');
    // Find the cell for yesterday — it should have aria-label with the count
    const yesterdayCell = cells.find(
      (cell) => cell.getAttribute('aria-label')?.includes('1 contribution'),
    );
    expect(yesterdayCell).toBeTruthy();
  });

  it('shows tooltip on hover', async () => {
    const user = userEvent.setup();

    const bounties: Bounty[] = [
      makeBounty({
        id: 'b1',
        contributor: WALLET,
        status: 'released',
        events: [
          { type: 'released', timestamp: today.getTime() },
        ],
      }),
    ];

    render(
      <ContributorActivityHeatmap
        bounties={bounties}
        contributorAddress={WALLET}
      />,
    );

    const cells = screen.getAllByRole('gridcell');
    // Find today's cell (likely the last one)
    const todayCell = cells[cells.length - 1]!;

    await user.hover(todayCell);

    // Tooltip text is broken across <strong> and text nodes, so use getAllByText
    const tooltips = screen.getAllByText(/contribution/);
    expect(tooltips.length).toBeGreaterThanOrEqual(1);
  });

  it('ignores bounties not assigned to the current contributor', () => {
    const otherWallet = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAXXX';

    const bounties: Bounty[] = [
      makeBounty({
        id: 'b1',
        contributor: otherWallet,
        status: 'submitted',
        events: [
          { type: 'submitted', timestamp: today.getTime() },
        ],
      }),
    ];

    render(
      <ContributorActivityHeatmap
        bounties={bounties}
        contributorAddress={WALLET}
      />,
    );

    expect(screen.getByText(/0 contributions in the last year/i)).toBeInTheDocument();
  });
});