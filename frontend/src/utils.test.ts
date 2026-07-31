import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterState } from './constants';
import type { Bounty } from './types';
import {
  computeDeadlineAt,
  deriveBountyStatus,
  filterBounties,
  formatAmount,
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
