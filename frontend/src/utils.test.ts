import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterState } from './constants';
import type { Bounty } from './types';
import {
  computeDeadlineAt,
  debounce,
  deriveBountyStatus,
  filterBounties,
  formatAmount,
  getActiveRewardLabel,
  getContributorMetrics,
  getRepoMetrics,
  getRewardBounds,
  getUniqueRepos,
  getUniqueTokenSymbols,
  resetXlmToUsdCache,
  sortBounties,
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

describe('debounce (#1274)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces multiple rapid calls and only triggers the last invocation after delay', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced('first');
    debounced('second');
    debounced('third');

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('third');
  });
});

describe('getUniqueRepos (#1274)', () => {
  it('returns sorted unique repository names', () => {
    const list: Bounty[] = [
      mockBounty({ id: '1', repo: 'zeta/repo' }),
      mockBounty({ id: '2', repo: 'alpha/repo' }),
      mockBounty({ id: '3', repo: 'alpha/repo' }),
    ];
    expect(getUniqueRepos(list)).toEqual(['alpha/repo', 'zeta/repo']);
  });

  it('returns an empty array for empty bounties', () => {
    expect(getUniqueRepos([])).toEqual([]);
  });
});

describe('getRepoMetrics (#1274)', () => {
  it('computes metrics across statuses and calculates totalFunded and totalPaidOut', () => {
    const list: Bounty[] = [
      mockBounty({ id: '1', repo: 'repoA', status: 'open', amount: 100 }),
      mockBounty({ id: '2', repo: 'repoA', status: 'reserved', amount: 200 }),
      mockBounty({ id: '3', repo: 'repoA', status: 'submitted', amount: 300 }),
      mockBounty({ id: '4', repo: 'repoA', status: 'released', amount: 400 }),
      mockBounty({ id: '5', repo: 'repoA', status: 'refunded', amount: 50 }),
      mockBounty({ id: '6', repo: 'repoA', status: 'expired', amount: 25 }),
      mockBounty({ id: '7', repo: 'repoB', status: 'open', amount: 999 }),
    ];

    const metrics = getRepoMetrics(list, 'repoA');
    expect(metrics.totalBounties).toBe(6);
    expect(metrics.openBounties).toBe(1);
    expect(metrics.reservedBounties).toBe(1);
    expect(metrics.submittedBounties).toBe(1);
    expect(metrics.releasedBounties).toBe(1);
    expect(metrics.refundedBounties).toBe(1);
    expect(metrics.expiredBounties).toBe(1);
    expect(metrics.totalFunded).toBe(1075);
    expect(metrics.totalPaidOut).toBe(400);
  });
});

describe('getRewardBounds (#1274)', () => {
  it('returns lowest and highest reward bounds', () => {
    const list: Bounty[] = [
      mockBounty({ id: '1', amount: 50 }),
      mockBounty({ id: '2', amount: 500 }),
      mockBounty({ id: '3', amount: 150 }),
    ];
    expect(getRewardBounds(list)).toEqual({ lowest: 50, highest: 500 });
  });

  it('returns { lowest: 0, highest: 0 } for empty list', () => {
    expect(getRewardBounds([])).toEqual({ lowest: 0, highest: 0 });
  });
});

describe('sortBounties (#1274)', () => {
  const b1 = mockBounty({ id: '1', amount: 100, createdAt: 10, deadlineAt: 100 });
  const b2 = mockBounty({ id: '2', amount: 300, createdAt: 30, deadlineAt: 300 });
  const b3 = mockBounty({ id: '3', amount: 200, createdAt: 20, deadlineAt: 200 });
  const list = [b1, b2, b3];

  it('sorts by reward-high asc and desc', () => {
    const asc = sortBounties(list, { option: 'reward-high', direction: 'asc' });
    expect(asc.map((b) => b.id)).toEqual(['1', '3', '2']);
    const desc = sortBounties(list, { option: 'reward-high', direction: 'desc' });
    expect(desc.map((b) => b.id)).toEqual(['2', '3', '1']);
  });

  it('sorts by reward-low asc and desc', () => {
    const asc = sortBounties(list, { option: 'reward-low', direction: 'asc' });
    expect(asc.map((b) => b.id)).toEqual(['1', '3', '2']);
    const desc = sortBounties(list, { option: 'reward-low', direction: 'desc' });
    expect(desc.map((b) => b.id)).toEqual(['2', '3', '1']);
  });

  it('sorts by deadline-soonest and deadline-latest', () => {
    const soonest = sortBounties(list, { option: 'deadline-soonest', direction: 'asc' });
    expect(soonest.map((b) => b.id)).toEqual(['1', '3', '2']);
    const latest = sortBounties(list, { option: 'deadline-latest', direction: 'desc' });
    expect(latest.map((b) => b.id)).toEqual(['2', '3', '1']);
  });

  it('sorts by newest and oldest', () => {
    const newest = sortBounties(list, { option: 'newest', direction: 'desc' });
    expect(newest.map((b) => b.id)).toEqual(['2', '3', '1']);
    const oldest = sortBounties(list, { option: 'oldest', direction: 'asc' });
    expect(oldest.map((b) => b.id)).toEqual(['1', '3', '2']);
  });
});

describe('getActiveRewardLabel (#1274)', () => {
  const bounds = { lowest: 10, highest: 500 };

  it('returns All rewards when bounds match', () => {
    expect(getActiveRewardLabel('10', '500', bounds)).toBe('All rewards');
    expect(getActiveRewardLabel('', '', bounds)).toBe('All rewards');
  });

  it('returns Up to X XLM when min equals lowest', () => {
    expect(getActiveRewardLabel('10', '250', bounds)).toBe('Up to 250 XLM');
  });

  it('returns X+ XLM when max equals highest', () => {
    expect(getActiveRewardLabel('100', '500', bounds)).toBe('100+ XLM');
  });

  it('returns range X - Y XLM when custom interval is selected', () => {
    expect(getActiveRewardLabel('50', '200', bounds)).toBe('50 - 200 XLM');
  });
});

describe('getContributorMetrics (#1274)', () => {
  it('returns empty result when contributorAddress is omitted', () => {
    const res = getContributorMetrics([mockBounty({ id: '1' })]);
    expect(res.contributor).toBeUndefined();
    expect(res.filtered).toHaveLength(0);
  });

  it('calculates counts by status and released totals by asset', () => {
    const list: Bounty[] = [
      mockBounty({ id: '1', contributor: 'ADDR1', status: 'open', amount: 100 }),
      mockBounty({
        id: '2',
        contributor: 'ADDR1',
        status: 'released',
        tokenSymbol: 'XLM',
        amount: 150,
      }),
      mockBounty({
        id: '3',
        contributor: 'ADDR1',
        status: 'released',
        tokenSymbol: 'USDC',
        amount: 50,
      }),
      mockBounty({
        id: '4',
        contributor: 'ADDR2',
        status: 'released',
        tokenSymbol: 'XLM',
        amount: 999,
      }),
    ];

    const res = getContributorMetrics(list, 'ADDR1');
    expect(res.filtered).toHaveLength(3);
    expect(res.countsByStatus.get('open')).toBe(1);
    expect(res.countsByStatus.get('released')).toBe(2);
    expect(res.releasedTotalsByAsset.get('XLM')).toBe(150);
    expect(res.releasedTotalsByAsset.get('USDC')).toBe(50);
  });
});
