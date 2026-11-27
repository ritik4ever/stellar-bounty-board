import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAllBounties } from './api';
import type { Bounty } from './types';

describe('listAllBounties', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches every page using a limit of 100', async () => {
    const firstBounty = { id: 'first' } as Bounty;
    const secondBounty = { id: 'second' } as Bounty;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [firstBounty], total: 2, page: 1, pageSize: 100, hasMore: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [secondBounty], total: 2, page: 2, pageSize: 100, hasMore: false }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listAllBounties({ contributor: 'GTEST' })).resolves.toEqual([firstBounty, secondBounty]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('page=1&limit=100');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('page=2&limit=100');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('contributor=GTEST');
  });
});