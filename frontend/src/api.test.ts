import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getBounty,
  getBountyEvents,
  refundBounty,
  releaseBounty,
  reserveBounty,
  submitBounty,
} from './api';

const bounty = {
  id: 'BNTY/42 with spaces',
  repo: 'owner/repo',
  issueNumber: 42,
  title: 'Encoded ID bounty',
  amount: 5,
  tokenSymbol: 'XLM',
  status: 'open' as const,
  maintainer: 'maintainer',
  createdAt: 1,
  updatedAt: 1,
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('bounty API path encoding', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse(bounty));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it.each([
    ['getBounty', () => getBounty(bounty.id), '/api/bounties/BNTY%2F42%20with%20spaces'],
    [
      'reserveBounty',
      () => reserveBounty(bounty.id, 'contributor'),
      '/api/bounties/BNTY%2F42%20with%20spaces/reserve',
    ],
    [
      'submitBounty',
      () => submitBounty(bounty.id, 'contributor', 'https://github.com/owner/repo/pull/1'),
      '/api/bounties/BNTY%2F42%20with%20spaces/submit',
    ],
    [
      'releaseBounty',
      () => releaseBounty(bounty.id, 'maintainer'),
      '/api/bounties/BNTY%2F42%20with%20spaces/release',
    ],
    [
      'refundBounty',
      () => refundBounty(bounty.id, 'maintainer'),
      '/api/bounties/BNTY%2F42%20with%20spaces/refund',
    ],
    [
      'getBountyEvents',
      () => {
        fetchMock.mockResolvedValueOnce(jsonResponse([]));
        return getBountyEvents(bounty.id);
      },
      '/api/bounties/BNTY%2F42%20with%20spaces/events',
    ],
  ])('%s encodes reserved characters in bounty IDs', async (_name, call, expectedUrl) => {
    await call();

    expect(fetchMock).toHaveBeenCalledWith(expectedUrl, expect.any(Object));
  });
});
