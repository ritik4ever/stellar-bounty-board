import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterState } from './constants';
import type { Bounty } from './types';
import {
  computeDeadlineAt,
  debounce,
  deriveBountyStatus,
  filterBounties,
  formatAmount,
  getRepoMetrics,
  getUniqueRepos,
  getUniqueTokenSymbols,
  resetXlmToUsdCache,
  xlmToUsd,
} from './utils';

describe('xlmToUsd', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetXlmToUsdCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the XLM/USD rate and formats the amount', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.124 } }),
    });

    await expect(xlmToUsd(100)).resolves.toBe('$12.40');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
      { signal: expect.any(AbortSignal) }
    );
  });

  it('caches the fetched rate for subsequent conversions', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.2 } }),
    });

    await expect(xlmToUsd(10)).resolves.toBe('$2.00');
    await expect(xlmToUsd(25)).resolves.toBe('$5.00');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back gracefully when the rate fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network unavailable'));

    await expect(xlmToUsd(100)).resolves.toBe('USD unavailable');
  });
});

describe('deadline helpers edge cases (#379)', () => {
  it('computes a deadline from Feb 29 in a leap year correctly', () => {
    const createdAt = Date.UTC(2024, 1, 29, 12, 0, 0);
    const deadlineAt = computeDeadlineAt(createdAt, 1);

    expect(new Date(deadlineAt).toISOString()).toBe('2024-03-01T12:00:00.000Z');
  });

  it('deadlineDays=0 produces a deadline within the same day', () => {
    const createdAt = Date.UTC(2024, 6, 10, 9, 30, 0);
    const deadlineAt = computeDeadlineAt(createdAt, 0);

    expect(deadlineAt).toBe(createdAt);
    expect(new Date(deadlineAt).toISOString().slice(0, 10)).toBe('2024-07-10');
  });

  it('does not expire at deadlineAt - 1ms but expires exactly at deadlineAt', () => {
    const deadlineAt = Date.UTC(2024, 6, 10, 12, 0, 0);

    expect(deriveBountyStatus('open', deadlineAt, deadlineAt - 1)).toBe('open');
    expect(deriveBountyStatus('open', deadlineAt, deadlineAt)).toBe('expired');
  });

  it('formats a zero XLM amount with seven decimals', () => {
    expect(formatAmount(0, 'XLM')).toBe('0.0000000 XLM');
  });
});

function mockBounty(overrides: Partial<Bounty>): Bounty {
  return {
    id: 'BNT-0001',
    repo: 'acme/widget',
    issueNumber: 1,
    title: 'Fix the widget',
    summary: 'A task',
    maintainer: 'GMAINTAINER',
    tokenSymbol: 'XLM',
    amount: 100,
    labels: [],
    status: 'open',
    createdAt: 1,
    deadlineAt: 2,
    version: 1,
    events: [],
    ...overrides,
  } as Bounty;
}

const baseFilters: FilterState = {
  searchQuery: '',
  statusFilter: 'all',
  minReward: '',
  maxReward: '',
  repoFilter: '',
  tokenFilter: '',
  sortOption: 'newest',
  sortDirection: 'desc',
};

const tokenBounties: Bounty[] = [
  mockBounty({ id: '1', tokenSymbol: 'XLM', status: 'open' }),
  mockBounty({ id: '2', tokenSymbol: 'USDC', status: 'open' }),
  mockBounty({ id: '3', tokenSymbol: 'XLM', status: 'released' }),
  mockBounty({ id: '4', tokenSymbol: 'usdc', status: 'reserved' }),
];

describe('getUniqueTokenSymbols (#293)', () => {
  it('returns distinct, uppercased, sorted token symbols', () => {
    expect(getUniqueTokenSymbols(tokenBounties)).toEqual(['USDC', 'XLM']);
  });

  it('returns an empty array for no bounties', () => {
    expect(getUniqueTokenSymbols([])).toEqual([]);
  });
});

describe('filterBounties — token filter (#293)', () => {
  it('filters to a single token case-insensitively', () => {
    const result = filterBounties(tokenBounties, {
      ...baseFilters,
      tokenFilter: 'USDC',
    });

    expect(result.map((bounty) => bounty.id).sort()).toEqual(['2', '4']);
  });

  it('combines token and status filters with AND logic', () => {
    const result = filterBounties(tokenBounties, {
      ...baseFilters,
      tokenFilter: 'XLM',
      statusFilter: 'open',
    });

    expect(result.map((bounty) => bounty.id)).toEqual(['1']);
  });

  it('returns all bounties when the token filter is empty', () => {
    expect(filterBounties(tokenBounties, baseFilters)).toHaveLength(4);
  });
});

describe('frontend utils comprehensive unit coverage (#1274)', () => {
  it('debounce executes the callback after the specified delay and cancels previous timers', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debounced = debounce(callback, 200);

    debounced('first');
    debounced('second');
    debounced('third');

    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('third');
    vi.useRealTimers();
  });

  it('getUniqueRepos returns distinct, sorted repository names', () => {
    const list: Bounty[] = [
      mockBounty({ id: '1', repo: 'org/repo-b' }),
      mockBounty({ id: '2', repo: 'org/repo-a' }),
      mockBounty({ id: '3', repo: 'org/repo-b' }),
    ];
    expect(getUniqueRepos(list)).toEqual(['org/repo-a', 'org/repo-b']);
  });

  it('deriveBountyStatus returns terminal statuses untouched and evaluates open bounties against deadline', () => {
    const now = 10000;
    expect(deriveBountyStatus('released', 5000, now)).toBe('released');
    expect(deriveBountyStatus('refunded', 5000, now)).toBe('refunded');
    expect(deriveBountyStatus('expired', 5000, now)).toBe('expired');
    expect(deriveBountyStatus('submitted', 5000, now)).toBe('submitted');
    expect(deriveBountyStatus('open', 15000, now)).toBe('open');
    expect(deriveBountyStatus('open', 10000, now)).toBe('expired');
    expect(deriveBountyStatus('reserved', 15000, now)).toBe('reserved');
    expect(deriveBountyStatus('reserved', 9000, now)).toBe('expired');
  });

  it('getRepoMetrics computes complete breakdown counts and totals correctly', () => {
    const metricsBounties: Bounty[] = [
      mockBounty({ id: '1', repo: 'target/repo', status: 'open', amount: 100 }),
      mockBounty({ id: '2', repo: 'target/repo', status: 'reserved', amount: 200 }),
      mockBounty({ id: '3', repo: 'target/repo', status: 'submitted', amount: 300 }),
      mockBounty({ id: '4', repo: 'target/repo', status: 'released', amount: 400 }),
      mockBounty({ id: '5', repo: 'target/repo', status: 'refunded', amount: 50 }),
      mockBounty({ id: '6', repo: 'target/repo', status: 'expired', amount: 50 }),
      mockBounty({ id: '7', repo: 'other/repo', status: 'open', amount: 1000 }),
    ];

    const metrics = getRepoMetrics(metricsBounties, 'target/repo');
    expect(metrics).toEqual({
      totalBounties: 6,
      openBounties: 1,
      reservedBounties: 1,
      submittedBounties: 1,
      releasedBounties: 1,
      refundedBounties: 1,
      expiredBounties: 1,
      totalFunded: 1100,
      totalPaidOut: 400,
    });
  });

  it('filterBounties supports min/max reward, repo filter, search query and sorting', () => {
    const filterData: Bounty[] = [
      mockBounty({ id: '1', repo: 'org/frontend', title: 'Fix CSS button', amount: 50, status: 'open', createdAt: 100 }),
      mockBounty({ id: '2', repo: 'org/backend', title: 'Add REST API auth', amount: 200, status: 'open', createdAt: 200 }),
      mockBounty({ id: '3', repo: 'org/contract', title: 'Soroban escrow refund', amount: 500, status: 'submitted', createdAt: 300 }),
    ];

    // Filter by minReward & maxReward
    const rewardFiltered = filterBounties(filterData, {
      ...baseFilters,
      minReward: '100',
      maxReward: '300',
    });
    expect(rewardFiltered.map((b) => b.id)).toEqual(['2']);

    // Filter by repo
    const repoFiltered = filterBounties(filterData, {
      ...baseFilters,
      repoFilter: 'org/frontend',
    });
    expect(repoFiltered.map((b) => b.id)).toEqual(['1']);

    // Filter by search query in title
    const searchFiltered = filterBounties(filterData, {
      ...baseFilters,
      searchQuery: 'escrow',
    });
    expect(searchFiltered.map((b) => b.id)).toEqual(['3']);

    // Sort by reward ascending
    const sortedAsc = filterBounties(filterData, {
      ...baseFilters,
      sortOption: 'reward',
      sortDirection: 'asc',
    });
    expect(sortedAsc.map((b) => b.id)).toEqual(['1', '2', '3']);

    // Sort by reward descending
    const sortedDesc = filterBounties(filterData, {
      ...baseFilters,
      sortOption: 'reward',
      sortDirection: 'desc',
    });
    expect(sortedDesc.map((b) => b.id)).toEqual(['3', '2', '1']);
  });
});

