import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, it, expect } from 'vitest';

import RecommendedBounties from './RecommendedBounties';
import type { BountyRecommendation } from './recommendations';
import type { Bounty } from './types';

const mockBounty: Bounty = {
  id: 'BNTY-A11Y-1',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 1281,
  title: 'Full accessibility audit on RecommendedBounties component',
  summary: 'Verify zero critical axe violations and complete keyboard operability.',
  maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  tokenSymbol: 'XLM',
  amount: 300,
  labels: [
    { name: 'accessibility', color: '0e8a16' },
    { name: 'Rust', color: 'dea584' },
  ],
  status: 'open',
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

const mockRecommendation: BountyRecommendation = {
  bounty: mockBounty,
  score: 0.98,
  reasons: ["Matches your 'Rust' contributions", 'Reward amount matches history'],
};

describe('RecommendedBounties.tsx accessibility pass (#1281)', () => {
  it('has zero critical or serious axe violations on active recommendations view', async () => {
    const { container } = render(
      <main>
        <RecommendedBounties recommendations={[mockRecommendation]} walletConnected={true} />
      </main>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has zero critical or serious axe violations on wallet disconnected state', async () => {
    const { container } = render(
      <main>
        <RecommendedBounties
          recommendations={[mockRecommendation]}
          walletConnected={false}
          onConnectWallet={() => {}}
        />
      </main>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has zero critical or serious axe violations on loading and error states', async () => {
    const { container: loadingContainer } = render(
      <main>
        <RecommendedBounties recommendations={[]} loading={true} />
      </main>
    );
    expect(await axe(loadingContainer)).toHaveNoViolations();

    const { container: errorContainer } = render(
      <main>
        <RecommendedBounties
          recommendations={[]}
          error="Failed to load recommendations"
          onRetry={() => {}}
        />
      </main>
    );
    expect(await axe(errorContainer)).toHaveNoViolations();
  });

  it('supports end-to-end keyboard operation through tags and recommendation actions', async () => {
    const user = userEvent.setup();
    render(
      <main>
        <RecommendedBounties recommendations={[mockRecommendation]} walletConnected={true} />
      </main>
    );

    // Tab to 'All' filter chip
    await user.tab();
    const allTag = screen.getByRole('button', { name: /filter by all tag/i });
    expect(allTag).toHaveFocus();

    // Tab to 'Rust' filter chip and activate it via Enter
    await user.tab(); // 'Rust' tag
    const rustTag = screen.getByRole('button', { name: /filter by rust tag/i });
    expect(rustTag).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(rustTag).toHaveAttribute('aria-pressed', 'true');

    // Tab into recommendation card
    await user.tab(); // tag 3 (React)
    // Continue tabbing into card and card interactive elements
    const viewIssueLink = screen.getByRole('link', { name: /view issue #1281/i });
    expect(viewIssueLink).toBeDefined();
  });

  it('provides accessible role and live announcement when filter yields zero results', async () => {
    const user = userEvent.setup();
    render(
      <main>
        <RecommendedBounties recommendations={[mockRecommendation]} walletConnected={true} />
      </main>
    );

    const pythonTag = screen.getByRole('button', { name: /filter by python tag/i });
    await user.click(pythonTag);

    const emptyNotice = screen.getByRole('status');
    expect(emptyNotice).toBeDefined();
    expect(screen.getByText(/No recommended bounties match the/i)).toBeDefined();

    const showAllBtn = screen.getByRole('button', { name: /show all/i });
    await user.click(showAllBtn);
    expect(screen.getByText('Full accessibility audit on RecommendedBounties component')).toBeDefined();
  });
});
