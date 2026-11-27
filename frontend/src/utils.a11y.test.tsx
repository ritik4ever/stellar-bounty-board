import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, it, expect } from 'vitest';

import {
  getAccessibleFilterAnnouncement,
  getAccessibleBountySummary,
  filterBounties,
} from './utils';
import type { Bounty } from './types';
import type { FilterState } from './constants';

const mockBounty: Bounty = {
  id: 'BNTY-UTILS-1',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 1275,
  title: 'Accessibility audit for utils module',
  summary: 'Validates zero axe violations on accessible utility outputs.',
  maintainer: 'GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST',
  tokenSymbol: 'USDC',
  amount: 300,
  labels: [{ name: 'a11y', color: '0e8a16' }],
  status: 'open',
  createdAt: 1700000000,
  deadlineAt: 1700086400,
  version: 1,
  events: [],
};

const initialFilters: FilterState = {
  statusFilter: 'all',
  repoFilter: '',
  tokenFilter: '',
  searchQuery: '',
  minReward: '',
  maxReward: '',
};

function AccessibleFilterAnnouncerWidget({ bounties }: { bounties: Bounty[] }) {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const filtered = filterBounties(bounties, filters);
  const announcement = getAccessibleFilterAnnouncement(filters, filtered.length);

  return (
    <main>
      <h1>Bounties Directory</h1>
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="live-region">
        {announcement}
      </div>

      <div role="search" aria-label="Bounty filters">
        <label htmlFor="search-input">Search bounties</label>
        <input
          id="search-input"
          type="text"
          value={filters.searchQuery}
          onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
          placeholder="Filter by keyword"
        />

        <fieldset>
          <legend>Status Filter</legend>
          <button
            type="button"
            onClick={() => setFilters({ ...filters, statusFilter: 'open' })}
            aria-pressed={filters.statusFilter === 'open'}
          >
            Show Open
          </button>
          <button
            type="button"
            onClick={() => setFilters({ ...filters, statusFilter: 'all' })}
            aria-pressed={filters.statusFilter === 'all'}
          >
            Show All
          </button>
        </fieldset>
      </div>

      <ul aria-label="Bounties list">
        {filtered.map((bounty) => (
          <li key={bounty.id} aria-label={getAccessibleBountySummary(bounty)}>
            <h3>{bounty.title}</h3>
            <span>
              {bounty.amount} {bounty.tokenSymbol}
            </span>
            <a
              href={`https://github.com/${bounty.repo}/issues/${bounty.issueNumber}`}
              aria-label={`View issue #${bounty.issueNumber} on GitHub`}
            >
              View Issue
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

describe('utils accessibility pass (#1275)', () => {
  it('has zero critical or serious axe violations in accessible utility UI', async () => {
    const { container } = render(<AccessibleFilterAnnouncerWidget bounties={[mockBounty]} />);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports full keyboard navigation through filters and interactive elements', async () => {
    const user = userEvent.setup();
    render(<AccessibleFilterAnnouncerWidget bounties={[mockBounty]} />);

    // Tab to search input
    await user.tab();
    const searchInput = screen.getByLabelText(/search bounties/i);
    expect(searchInput).toHaveFocus();

    // Tab to Show Open button
    await user.tab();
    const openBtn = screen.getByRole('button', { name: /show open/i });
    expect(openBtn).toHaveFocus();

    // Activate button via keyboard
    await user.keyboard('{Enter}');
    expect(openBtn).toHaveAttribute('aria-pressed', 'true');

    // Tab to link
    await user.tab(); // Show All
    await user.tab(); // View Issue link
    const link = screen.getByRole('link', { name: /view issue #1275 on github/i });
    expect(link).toHaveFocus();
  });

  it('generates accurate accessible filter announcements and bounty summaries', () => {
    const announcement = getAccessibleFilterAnnouncement(
      { ...initialFilters, statusFilter: 'open', searchQuery: 'stellar' },
      3
    );
    expect(announcement).toContain('3 bounties found');
    expect(announcement).toContain('status open');
    expect(announcement).toContain('query "stellar"');

    const summary = getAccessibleBountySummary(mockBounty);
    expect(summary).toContain('Bounty #1275: Accessibility audit for utils module');
    expect(summary).toContain('300.0000000 USDC');
    expect(summary).toContain('status open');
  });
});
