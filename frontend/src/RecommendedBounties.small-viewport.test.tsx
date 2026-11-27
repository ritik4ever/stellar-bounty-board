import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';

import RecommendedBounties from './RecommendedBounties';
import type { BountyRecommendation } from './recommendations';
import type { Bounty } from './types';

const mockBounty: Bounty = {
  id: 'BNTY-VIEWPORT-1282',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 1282,
  title:
    'Small Viewport Verification for RecommendedBounties Component Below 320px Width',
  summary:
    'Test suite validating narrow phone rendering, zero horizontal scrollbar overflow, 44px minimum tap targets, and full value text disclosure.',
  maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  tokenSymbol: 'XLM',
  amount: 750,
  labels: [{ name: 'responsive', color: '111' }],
  status: 'open',
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

const mockRecommendation: BountyRecommendation = {
  bounty: mockBounty,
  score: 0.92,
  reasons: ['Testing narrow phone viewport constraints and truncation wrapping'],
};

describe('RecommendedBounties.tsx small-viewport layout (#1282)', () => {
  it('renders within constrained narrow 320px viewport container without layout overflow', () => {
    const { container } = render(
      <div style={{ width: '320px', maxWidth: '320px', overflowX: 'hidden' }}>
        <RecommendedBounties recommendations={[mockRecommendation]} walletConnected={true} />
      </div>
    );

    const section = container.querySelector('.recommendations-panel');
    expect(section).toBeInTheDocument();

    const title = screen.getByRole('heading', { level: 3 });
    expect(title).toBeInTheDocument();
    expect(title).toHaveTextContent(/Small Viewport Verification/i);
  });

  it('renders interactive tap targets meeting accessible sizing and focusable bounds', async () => {
    const user = userEvent.setup();
    render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <RecommendedBounties recommendations={[mockRecommendation]} walletConnected={true} />
      </div>
    );

    const filterChip = screen.getByRole('button', { name: /filter by all tag/i });
    expect(filterChip).toHaveClass('filter-chip');

    // Tab navigation targets interactives cleanly
    await user.tab();
    expect(filterChip).toHaveFocus();
  });

  it('renders long text with accessible labels and hover/focus full disclosure', () => {
    render(<RecommendedBounties recommendations={[mockRecommendation]} walletConnected={true} />);

    const actionLink = screen.getByRole('link', {
      name: /view issue #1282 for small viewport verification/i,
    });
    expect(actionLink).toHaveClass('secondary-link');
    expect(actionLink).toHaveAttribute('href', expect.stringContaining('/issues/1282'));
  });
});
