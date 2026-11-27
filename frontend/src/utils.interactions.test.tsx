import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';

import { filterBounties, sortBounties, type SortState } from './utils';
import type { Bounty } from './types';
import type { FilterState } from './constants';

const sampleBounties: Bounty[] = [
  {
    id: 'BNTY-1',
    repo: 'stellar/core',
    issueNumber: 101,
    title: 'Implement Consensus Optimization',
    summary: 'Core performance optimization in consensus layer.',
    maintainer: 'GMAINTAINER1',
    tokenSymbol: 'XLM',
    amount: 1000,
    labels: [{ name: 'core', color: '1f883d' }],
    status: 'open',
    createdAt: 1000,
    deadlineAt: 5000,
    version: 1,
    events: [],
  },
  {
    id: 'BNTY-2',
    repo: 'stellar/soroban',
    issueNumber: 202,
    title: 'Add Smart Contract Template',
    summary: 'Developer documentation and quickstart smart contract templates.',
    maintainer: 'GMAINTAINER2',
    tokenSymbol: 'USDC',
    amount: 500,
    labels: [{ name: 'soroban', color: '0e8a16' }],
    status: 'reserved',
    createdAt: 2000,
    deadlineAt: 6000,
    version: 1,
    events: [],
  },
  {
    id: 'BNTY-3',
    repo: 'stellar/dashboard',
    issueNumber: 303,
    title: 'Fix Dark Mode Contrast',
    summary: 'Accessibility styling polish on bounty card status badges.',
    maintainer: 'GMAINTAINER3',
    tokenSymbol: 'XLM',
    amount: 250,
    labels: [{ name: 'frontend', color: '61dafb' }],
    status: 'released',
    createdAt: 3000,
    deadlineAt: 7000,
    version: 1,
    events: [],
  },
];

const initialFilters: FilterState = {
  statusFilter: 'all',
  repoFilter: '',
  tokenFilter: '',
  searchQuery: '',
  minReward: '',
  maxReward: '',
};

function InteractiveUtilsConsumer({ bounties }: { bounties: Bounty[] }) {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [sort, setSort] = useState<SortState>({ option: 'newest', direction: 'desc' });

  const filtered = filterBounties(bounties, filters);
  const sorted = sortBounties(filtered, sort);

  return (
    <div data-testid="utils-interactive-container">
      <header>
        <h2>Bounty Explorer</h2>
        <span data-testid="results-count">{sorted.length} results</span>
      </header>

      <section aria-label="Filters">
        <label htmlFor="interactive-search">Search</label>
        <input
          id="interactive-search"
          type="text"
          value={filters.searchQuery}
          onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
          placeholder="Filter bounties"
        />

        <button type="button" onClick={() => setFilters({ ...filters, statusFilter: 'open' })}>
          Filter Open Only
        </button>

        <button type="button" onClick={() => setFilters(initialFilters)}>
          Reset Filters
        </button>

        <label htmlFor="interactive-sort">Sort by</label>
        <select
          id="interactive-sort"
          value={sort.option}
          onChange={(e) => setSort({ ...sort, option: e.target.value as any })}
        >
          <option value="newest">Newest</option>
          <option value="reward-high">Reward High to Low</option>
          <option value="reward-low">Reward Low to High</option>
        </select>
      </section>

      <ul aria-label="Filtered Bounties">
        {sorted.map((b) => (
          <li key={b.id} data-testid={`bounty-item-${b.id}`}>
            <h3>{b.title}</h3>
            <span>
              {b.amount} {b.tokenSymbol}
            </span>
            <span>{b.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

describe('utils interactions test (#1274)', () => {
  it('updates filtered results when user types in search via user-event', async () => {
    const user = userEvent.setup();
    render(<InteractiveUtilsConsumer bounties={sampleBounties} />);

    expect(screen.getByTestId('results-count')).toHaveTextContent('3 results');

    const searchInput = screen.getByLabelText(/search/i);
    await user.type(searchInput, 'Consensus');

    expect(searchInput).toHaveValue('Consensus');
    expect(screen.getByTestId('results-count')).toHaveTextContent('1 results');
    expect(screen.getByText('Implement Consensus Optimization')).toBeInTheDocument();
    expect(screen.queryByText('Add Smart Contract Template')).not.toBeInTheDocument();
  });

  it('updates results when user clicks status filter button via user-event', async () => {
    const user = userEvent.setup();
    render(<InteractiveUtilsConsumer bounties={sampleBounties} />);

    const filterOpenBtn = screen.getByRole('button', { name: /filter open only/i });
    await user.click(filterOpenBtn);

    expect(screen.getByTestId('results-count')).toHaveTextContent('1 results');
    expect(screen.getByText('Implement Consensus Optimization')).toBeInTheDocument();

    const resetBtn = screen.getByRole('button', { name: /reset filters/i });
    await user.click(resetBtn);
    expect(screen.getByTestId('results-count')).toHaveTextContent('3 results');
  });

  it('re-orders results when user selects sort option via user-event', async () => {
    const user = userEvent.setup();
    render(<InteractiveUtilsConsumer bounties={sampleBounties} />);

    const sortSelect = screen.getByLabelText(/sort by/i);
    await user.selectOptions(sortSelect, 'reward-low');

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Fix Dark Mode Contrast'); // 250
    expect(items[1]).toHaveTextContent('Add Smart Contract Template'); // 500
    expect(items[2]).toHaveTextContent('Implement Consensus Optimization'); // 1000
  });
});
