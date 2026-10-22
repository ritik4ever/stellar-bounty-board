import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, it, expect } from 'vitest';

import RecommendedBounties from './RecommendedBounties';
import { getAccessibleRecommendationLabel, type BountyRecommendation } from './recommendations';
import type { Bounty } from './types';

const mockBounty: Bounty = {
  id: 'BNTY-REC-1',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 1291,
  title: 'Accessibility audit for recommendations engine',
  summary: 'Verify zero critical axe violations and full keyboard operation.',
  maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  tokenSymbol: 'USDC',
  amount: 250,
  labels: [
    { name: 'accessibility', color: '0e8a16' },
    { name: 'react', color: '61dafb' },
  ],
  status: 'open',
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

const mockRecommendation: BountyRecommendation = {
  bounty: mockBounty,
  score: 0.95,
  reasons: ["You've worked with 'react' before", 'Matches 100% of your skills'],
};

describe('recommendations accessibility pass (#1291)', () => {
  it('has zero critical or serious axe violations on rendered recommendations', async () => {
    const { container } = render(
      <main>
        <RecommendedBounties recommendations={[mockRecommendation]} walletConnected={true} />
      </main>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports end-to-end keyboard navigation through filter chips and cards', async () => {
    const user = userEvent.setup();
    render(
      <main>
        <RecommendedBounties recommendations={[mockRecommendation]} walletConnected={true} />
      </main>
    );

    // Tab into first filter chip ('All')
    await user.tab();
    const allChip = screen.getByRole('button', { name: /filter by all tag/i });
    expect(allChip).toHaveFocus();
    expect(allChip).toHaveAttribute('aria-pressed', 'true');

    // Tab into second filter chip ('Rust')
    await user.tab();
    const rustChip = screen.getByRole('button', { name: /filter by rust tag/i });
    expect(rustChip).toHaveFocus();
    expect(rustChip).toHaveAttribute('aria-pressed', 'false');

    // Press Enter to activate Rust filter
    await user.keyboard('{Enter}');
    expect(rustChip).toHaveAttribute('aria-pressed', 'true');

    // Empty state should be announced via aria-live
    const emptyState = screen.getByRole('status');
    expect(emptyState).toHaveAttribute('aria-live', 'polite');
    expect(emptyState).toHaveTextContent(/no recommended bounties match the rust tag/i);

    // Reset back to All via button
    const showAllBtn = screen.getByRole('button', { name: /show all/i });
    await user.click(showAllBtn);

    // Bounty card should be in the document and have accessible label
    const card = screen.getByLabelText(/95% match for bounty accessibility audit/i);
    expect(card).toBeInTheDocument();
  });

  it('provides accessible names on all interactive links', () => {
    render(<RecommendedBounties recommendations={[mockRecommendation]} walletConnected={true} />);

    const repoLink = screen.getByRole('link', {
      name: /view issue #1291 on github/i,
    });
    expect(repoLink).toBeInTheDocument();

    const detailLink = screen.getByRole('link', {
      name: /view issue #1291 for accessibility audit for recommendations engine/i,
    });
    expect(detailLink).toBeInTheDocument();
  });

  it('generates descriptive accessible recommendation labels', () => {
    const label = getAccessibleRecommendationLabel(mockRecommendation);
    expect(label).toContain('95% match for bounty Accessibility audit for recommendations engine');
    expect(label).toContain("You've worked with 'react' before");
  });
});
