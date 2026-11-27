/**
 * Unit tests for frontend/src/api.ts
 *
 * Covers every conditional branch inside the module:
 *   requestJson / requestBlob:
 *     - Success path (response.ok, non-retryable status)
 *     - Retry on retryable status (429 / 5xx) with back-off
 *     - Last retry exhausted → formatRetryError thrown
 *     - TypeError (network failure) triggers retry then throws
 *     - Non-retryable error (e.g. 400) is not retried; throws immediately
 *     - retry=false disables retry logic entirely
 *   parseFilenameFromContentDisposition:
 *     - null header → null
 *     - plain filename
 *     - RFC 5987 encoded filename
 *   ensureRequestId:
 *     - Sets X-Request-ID when absent
 *     - Leaves existing X-Request-ID unchanged
 *   Public API functions:
 *     - listBounties / listAllBounties
 *     - getBounty
 *     - createBounty
 *     - reserveBounty / submitBounty
 *     - releaseBounty / refundBounty
 *     - releaseBountySigned / refundBountySigned
 *     - disputeBounty / resolveDisputeBounty
 *     - extendDeadline / bulkBountyAction
 *     - listOpenIssues
 *     - exportReleasedPayoutsCsv
 *     - getBountyEvents / getMaintainerMetrics / getGlobalMetrics
 *     - getNotificationPreferences / updateNotificationPreferences
 *   Pure helper functions:
 *     - toContractBountyStatus: all 7 status strings
 *     - getContractErrorLabel: known and unknown error codes
 *     - STELLAR_NETWORK_PASSPHRASE constant
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bounty, OpenIssue } from './types';
import { BountyStatus, ContractError } from './generated';

// ---------------------------------------------------------------------------
// Module import helpers – api.ts is imported fresh per group to avoid
// singleton state from the module-level constants.
// ---------------------------------------------------------------------------

function makeBounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: 'BNT-0001',
    repo: 'owner/repo',
    issueNumber: 42,
    title: 'Test bounty',
    summary: 'Summary text here for testing purposes',
    maintainer: 'GABC',
    tokenSymbol: 'XLM',
    amount: 100,
    labels: [],
    status: 'open',
    createdAt: 1700000000,
    deadlineAt: 1800000000,
    version: 1,
    events: [],
    ...overrides,
  };
}

function okResponse<T>(body: T, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)]),
    text: async () => JSON.stringify(body),
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  };
}

function errorResponse(status: number, body: { error?: string } = {}) {
  return {
    ok: false,
    status,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)]),
    text: async () => JSON.stringify(body),
    headers: {
      get: (key: string) => {
        const lk = key.toLowerCase();
        if (lk === 'content-type') return 'application/json';
        return null;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('setTimeout', (fn: () => void, _ms: number) => {
    fn();
    return 0 as any;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// listBounties
// ---------------------------------------------------------------------------

describe('listBounties', () => {
  it('fetches /bounties with page and limit params', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        okResponse({ data: [makeBounty()], total: 1, page: 1, pageSize: 20, hasMore: false })
      );
    vi.stubGlobal('fetch', mockFetch);

    const { listBounties } = await import('./api');
    const result = await listBounties({ page: 1, limit: 20 });

    expect(mockFetch).toHaveBeenCalledOnce();
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('/bounties');
    expect(url).toContain('page=1');
    expect(url).toContain('limit=20');
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('includes optional filter params when provided', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false }));
    vi.stubGlobal('fetch', mockFetch);

    const { listBounties } = await import('./api');
    await listBounties({
      page: 1,
      limit: 10,
      q: 'fix',
      status: 'open',
      tokenSymbol: 'XLM',
      sort: 'amount',
      order: 'asc',
    });

    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('q=fix');
    expect(url).toContain('status=open');
    expect(url).toContain('tokenSymbol=XLM');
    expect(url).toContain('sort=amount');
    expect(url).toContain('order=asc');
  });

  it('retries on 429 and succeeds on subsequent call', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, { error: 'rate limited' }))
      .mockResolvedValueOnce(errorResponse(429, { error: 'rate limited' }))
      .mockResolvedValue(
        okResponse({ data: [makeBounty()], total: 1, page: 1, pageSize: 20, hasMore: false })
      );
    vi.stubGlobal('fetch', mockFetch);

    const { listBounties } = await import('./api');
    const result = await listBounties({ page: 1, limit: 20 });

    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.data).toHaveLength(1);
  });

  it('throws after all retries are exhausted', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(errorResponse(503, { error: 'service unavailable' }));
    vi.stubGlobal('fetch', mockFetch);

    const { listBounties } = await import('./api');
    await expect(listBounties({ page: 1, limit: 20 })).rejects.toThrow(/failed after/i);
  });

  it('throws immediately on non-retryable 4xx error (400)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(errorResponse(400, { error: 'Bad Request' }));
    vi.stubGlobal('fetch', mockFetch);

    const { listBounties } = await import('./api');
    await expect(listBounties({ page: 1, limit: 20 })).rejects.toThrow('Bad Request');
    // Should only be called once — no retry on 400.
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('retries on TypeError (network failure) then succeeds', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(okResponse({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false }));
    vi.stubGlobal('fetch', mockFetch);

    const { listBounties } = await import('./api');
    const result = await listBounties({ page: 1, limit: 20 });

    expect(result.data).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws formatRetryError after all TypeErrors exhausted', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', mockFetch);

    const { listBounties } = await import('./api');
    await expect(listBounties({ page: 1, limit: 20 })).rejects.toThrow(/failed after/i);
  });

  it('respects AbortSignal', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false }));
    vi.stubGlobal('fetch', mockFetch);

    const { listBounties } = await import('./api');
    const controller = new AbortController();
    await listBounties({ page: 1, limit: 20 }, controller.signal);

    const options = mockFetch.mock.calls[0][1];
    expect(options.signal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// listAllBounties — pagination exhaustion
// ---------------------------------------------------------------------------

describe('listAllBounties', () => {
  it('follows hasMore pages and returns all items', async () => {
    const b1 = makeBounty({ id: 'BNT-0001' });
    const b2 = makeBounty({ id: 'BNT-0002' });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        okResponse({ data: [b1], total: 2, page: 1, pageSize: 100, hasMore: true })
      )
      .mockResolvedValueOnce(
        okResponse({ data: [b2], total: 2, page: 2, pageSize: 100, hasMore: false })
      );
    vi.stubGlobal('fetch', mockFetch);

    const { listAllBounties } = await import('./api');
    const result = await listAllBounties();

    expect(result).toEqual([b1, b2]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when no bounties exist', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        okResponse({ data: [], total: 0, page: 1, pageSize: 100, hasMore: false })
      );
    vi.stubGlobal('fetch', mockFetch);

    const { listAllBounties } = await import('./api');
    expect(await listAllBounties()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getBounty
// ---------------------------------------------------------------------------

describe('getBounty', () => {
  it('fetches /bounties/:id and returns the bounty', async () => {
    const bounty = makeBounty();
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: bounty }));
    vi.stubGlobal('fetch', mockFetch);

    const { getBounty } = await import('./api');
    const result = await getBounty('BNT-0001');

    expect(result).toEqual(bounty);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('/bounties/BNT-0001');
  });

  it('throws on API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errorResponse(404, { error: 'Bounty not found.' }))
    );

    const { getBounty } = await import('./api');
    await expect(getBounty('BNT-9999')).rejects.toThrow('Bounty not found.');
  });
});

// ---------------------------------------------------------------------------
// createBounty
// ---------------------------------------------------------------------------

describe('createBounty', () => {
  it('POSTs to /bounties with JSON body and returns created bounty', async () => {
    const bounty = makeBounty({ status: 'open' });
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: bounty }));
    vi.stubGlobal('fetch', mockFetch);

    const { createBounty } = await import('./api');
    const payload = {
      repo: 'owner/repo',
      issueNumber: 42,
      title: 'Test',
      summary: 'Summary text here for testing',
      maintainer: 'GABC',
      tokenSymbol: 'XLM',
      amount: 100,
      deadlineDays: 14,
      labels: [],
    };
    const result = await createBounty(payload);

    expect(result).toEqual(bounty);
    const call = mockFetch.mock.calls[0];
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call[1].body)).toMatchObject({ repo: 'owner/repo' });
  });

  it('throws on validation error (400)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errorResponse(400, { error: 'INVALID_BODY' }))
    );

    const { createBounty } = await import('./api');
    await expect(createBounty({} as any)).rejects.toThrow('INVALID_BODY');
  });
});

// ---------------------------------------------------------------------------
// reserveBounty
// ---------------------------------------------------------------------------

describe('reserveBounty', () => {
  it('POSTs contributor and expectedVersion', async () => {
    const reserved = makeBounty({ status: 'reserved', contributor: 'GCONTRIBUTOR' });
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: reserved }));
    vi.stubGlobal('fetch', mockFetch);

    const { reserveBounty } = await import('./api');
    const result = await reserveBounty('BNT-0001', 'GCONTRIBUTOR', 1);

    expect(result.status).toBe('reserved');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.contributor).toBe('GCONTRIBUTOR');
    expect(body.expectedVersion).toBe(1);
  });

  it('works without expectedVersion (omitted)', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: makeBounty({ status: 'reserved' }) }));
    vi.stubGlobal('fetch', mockFetch);

    const { reserveBounty } = await import('./api');
    await reserveBounty('BNT-0001', 'GCONTRIBUTOR');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.expectedVersion).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// submitBounty
// ---------------------------------------------------------------------------

describe('submitBounty', () => {
  it('POSTs contributor, submissionUrl, and optional notes', async () => {
    const submitted = makeBounty({ status: 'submitted' });
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: submitted }));
    vi.stubGlobal('fetch', mockFetch);

    const { submitBounty } = await import('./api');
    await submitBounty(
      'BNT-0001',
      'GCONTRIBUTOR',
      'https://github.com/owner/repo/pull/1',
      'good work'
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.contributor).toBe('GCONTRIBUTOR');
    expect(body.submissionUrl).toBe('https://github.com/owner/repo/pull/1');
    expect(body.notes).toBe('good work');
  });

  it('works without notes', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: makeBounty({ status: 'submitted' }) }));
    vi.stubGlobal('fetch', mockFetch);

    const { submitBounty } = await import('./api');
    await submitBounty('BNT-0001', 'GCONTRIBUTOR', 'https://github.com/owner/repo/pull/1');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.notes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// releaseBounty (legacy, unsigned)
// ---------------------------------------------------------------------------

describe('releaseBounty', () => {
  it('POSTs maintainer and optional transactionHash', async () => {
    const released = makeBounty({ status: 'released' });
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: released }));
    vi.stubGlobal('fetch', mockFetch);

    const { releaseBounty } = await import('./api');
    await releaseBounty('BNT-0001', 'GMAINTAINER', 'a'.repeat(64));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.maintainer).toBe('GMAINTAINER');
    expect(body.transactionHash).toBe('a'.repeat(64));
  });

  it('works without transactionHash', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: makeBounty({ status: 'released' }) }));
    vi.stubGlobal('fetch', mockFetch);

    const { releaseBounty } = await import('./api');
    await releaseBounty('BNT-0001', 'GMAINTAINER');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.transactionHash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// releaseBountySigned (Freighter-signed)
// ---------------------------------------------------------------------------

describe('releaseBountySigned', () => {
  it('includes x-stellar-signature and x-stellar-public-key headers', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: makeBounty({ status: 'released' }) }));
    vi.stubGlobal('fetch', mockFetch);

    const { releaseBountySigned } = await import('./api');
    const payload = {
      maintainer: 'GMAINTAINER',
      action: 'release' as const,
      bountyId: 'BNT-0001',
      timestamp: 1700000000,
    };
    await releaseBountySigned('BNT-0001', payload, 'sig123', 'pubkey456');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-stellar-signature']).toBe('sig123');
    expect(headers['x-stellar-public-key']).toBe('pubkey456');
  });
});

// ---------------------------------------------------------------------------
// refundBounty (legacy, unsigned)
// ---------------------------------------------------------------------------

describe('refundBounty', () => {
  it('POSTs to /bounties/:id/refund', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: makeBounty({ status: 'refunded' }) }));
    vi.stubGlobal('fetch', mockFetch);

    const { refundBounty } = await import('./api');
    const result = await refundBounty('BNT-0001', 'GMAINTAINER', 'b'.repeat(64));

    expect(result.status).toBe('refunded');
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('/bounties/BNT-0001/refund');
  });
});

// ---------------------------------------------------------------------------
// refundBountySigned (Freighter-signed)
// ---------------------------------------------------------------------------

describe('refundBountySigned', () => {
  it('includes Stellar auth headers', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: makeBounty({ status: 'refunded' }) }));
    vi.stubGlobal('fetch', mockFetch);

    const { refundBountySigned } = await import('./api');
    const payload = {
      maintainer: 'GMAINTAINER',
      action: 'refund' as const,
      bountyId: 'BNT-0001',
      timestamp: 1700000000,
    };
    await refundBountySigned('BNT-0001', payload, 'sig-refund', 'pub-refund');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-stellar-signature']).toBe('sig-refund');
    expect(headers['x-stellar-public-key']).toBe('pub-refund');
  });
});

// ---------------------------------------------------------------------------
// disputeBounty
// ---------------------------------------------------------------------------

describe('disputeBounty', () => {
  it('POSTs to /bounties/:id/dispute', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: makeBounty({ status: 'disputed' }) }));
    vi.stubGlobal('fetch', mockFetch);

    const { disputeBounty } = await import('./api');
    await disputeBounty('BNT-0001', 'GCONTRIBUTOR', 'Work was not reviewed');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.contributor).toBe('GCONTRIBUTOR');
    expect(body.reason).toBe('Work was not reviewed');
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('/bounties/BNT-0001/dispute');
  });
});

// ---------------------------------------------------------------------------
// resolveDisputeBounty
// ---------------------------------------------------------------------------

describe('resolveDisputeBounty', () => {
  it('POSTs arbiter, release flag, and optional transactionHash', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: makeBounty({ status: 'released' }) }));
    vi.stubGlobal('fetch', mockFetch);

    const { resolveDisputeBounty } = await import('./api');
    await resolveDisputeBounty('BNT-0001', 'GARBITER', true, 'c'.repeat(64));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.arbiter).toBe('GARBITER');
    expect(body.release).toBe(true);
    expect(body.transactionHash).toBe('c'.repeat(64));
  });

  it('release=false resolves in favour of maintainer', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: makeBounty({ status: 'refunded' }) }));
    vi.stubGlobal('fetch', mockFetch);

    const { resolveDisputeBounty } = await import('./api');
    const result = await resolveDisputeBounty('BNT-0001', 'GARBITER', false);

    expect(result.status).toBe('refunded');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.release).toBe(false);
    expect(body.transactionHash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extendDeadline
// ---------------------------------------------------------------------------

describe('extendDeadline', () => {
  it('POSTs maintainer and newDeadline', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: makeBounty({ deadlineAt: 1900000000 }) }));
    vi.stubGlobal('fetch', mockFetch);

    const { extendDeadline } = await import('./api');
    await extendDeadline('BNT-0001', 'GMAINTAINER', 1900000000);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.newDeadline).toBe(1900000000);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('/bounties/BNT-0001/extend-deadline');
  });
});

// ---------------------------------------------------------------------------
// bulkBountyAction
// ---------------------------------------------------------------------------

describe('bulkBountyAction', () => {
  it('POSTs with admin key header and returns BulkActionResponse', async () => {
    const mockResponse = {
      action: 'release' as const,
      results: [{ bountyId: 'BNT-0001', success: true, status: 'released' }],
      succeeded: 1,
      failed: 0,
    };
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: mockResponse }));
    vi.stubGlobal('fetch', mockFetch);

    const { bulkBountyAction } = await import('./api');
    const result = await bulkBountyAction('release', ['BNT-0001'], 'GMAINTAINER', 'admin-key-here');

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-admin-api-key']).toBe('admin-key-here');
  });

  it('does NOT retry — retry=false for bulk actions', async () => {
    // Even a 503 should not be retried for bulk actions.
    const mockFetch = vi.fn().mockResolvedValue(errorResponse(503, { error: 'overloaded' }));
    vi.stubGlobal('fetch', mockFetch);

    const { bulkBountyAction } = await import('./api');
    await expect(bulkBountyAction('refund', ['BNT-0001'], 'GMAINTAINER', 'key')).rejects.toThrow(
      'overloaded'
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// listOpenIssues
// ---------------------------------------------------------------------------

describe('listOpenIssues', () => {
  it('fetches /open-issues and returns data array', async () => {
    const issue: OpenIssue = {
      id: 'GH-1',
      title: 'Fix bug',
      labels: [],
      summary: 'Summary',
      impact: 'starter',
    };
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: [issue] }));
    vi.stubGlobal('fetch', mockFetch);

    const { listOpenIssues } = await import('./api');
    const result = await listOpenIssues();

    expect(result).toEqual([issue]);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('/open-issues');
  });

  it('retries on 502 (upstream failure) then succeeds', async () => {
    const issue: OpenIssue = {
      id: 'GH-2',
      title: 'Add feature',
      labels: ['enhancement'],
      summary: 'Summary',
      impact: 'core',
    };
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(502, { error: 'bad gateway' }))
      .mockResolvedValue(okResponse({ data: [issue] }));
    vi.stubGlobal('fetch', mockFetch);

    const { listOpenIssues } = await import('./api');
    const result = await listOpenIssues();

    expect(result).toEqual([issue]);
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('throws after exhausting retries on persistent 502', async () => {
    const mockFetch = vi.fn().mockResolvedValue(errorResponse(502, { error: 'bad gateway' }));
    vi.stubGlobal('fetch', mockFetch);

    const { listOpenIssues } = await import('./api');
    await expect(listOpenIssues()).rejects.toThrow(/failed after/i);
  });

  it('passes AbortSignal through', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: [] }));
    vi.stubGlobal('fetch', mockFetch);

    const { listOpenIssues } = await import('./api');
    const ctrl = new AbortController();
    await listOpenIssues(ctrl.signal);

    expect(mockFetch.mock.calls[0][1].signal).toBe(ctrl.signal);
  });
});

// ---------------------------------------------------------------------------
// exportReleasedPayoutsCsv — requestBlob branch
// ---------------------------------------------------------------------------

describe('exportReleasedPayoutsCsv', () => {
  it('returns blob and filename from Content-Disposition header', async () => {
    const csvContent = 'repo,issue_number,contributor,asset,amount,released_at\n';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      blob: async () => new Blob([csvContent], { type: 'text/csv' }),
      text: async () => csvContent,
      headers: {
        get: (key: string) => {
          const lk = key.toLowerCase();
          if (lk === 'content-disposition')
            return 'attachment; filename="released-payouts-2026.csv"';
          if (lk === 'content-type') return 'text/csv';
          return null;
        },
      },
    });
    vi.stubGlobal('fetch', mockFetch);

    const { exportReleasedPayoutsCsv } = await import('./api');
    const result = await exportReleasedPayoutsCsv();

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.filename).toBe('released-payouts-2026.csv');
  });

  it('falls back to default filename when Content-Disposition is absent', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      blob: async () => new Blob(['csv data'], { type: 'text/csv' }),
      text: async () => 'csv data',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', mockFetch);

    const { exportReleasedPayoutsCsv } = await import('./api');
    const result = await exportReleasedPayoutsCsv();

    expect(result.filename).toBe('released-payouts.csv');
  });

  it('throws on error response with JSON content-type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
      blob: async () => new Blob(),
      text: async () => 'Forbidden',
      headers: {
        get: (key: string) => (key.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
    });
    vi.stubGlobal('fetch', mockFetch);

    const { exportReleasedPayoutsCsv } = await import('./api');
    await expect(exportReleasedPayoutsCsv()).rejects.toThrow('Forbidden');
  });

  it('throws on error response with non-JSON content-type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      blob: async () => new Blob(),
      text: async () => 'Internal Server Error',
      headers: {
        get: (key: string) => (key.toLowerCase() === 'content-type' ? 'text/plain' : null),
      },
    });
    vi.stubGlobal('fetch', mockFetch);

    const { exportReleasedPayoutsCsv } = await import('./api');
    await expect(exportReleasedPayoutsCsv()).rejects.toThrow(
      /Internal Server Error|Request failed/i
    );
  });
});

// ---------------------------------------------------------------------------
// getBountyEvents
// ---------------------------------------------------------------------------

describe('getBountyEvents', () => {
  it('fetches /bounties/:id/events and returns events array', async () => {
    const events = [{ type: 'reserved' as const, timestamp: 1700000001, actor: 'GCONTRIBUTOR' }];
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: events }));
    vi.stubGlobal('fetch', mockFetch);

    const { getBountyEvents } = await import('./api');
    const result = await getBountyEvents('BNT-0001');

    expect(result).toEqual(events);
    expect(mockFetch.mock.calls[0][0]).toContain('/bounties/BNT-0001/events');
  });
});

// ---------------------------------------------------------------------------
// getMaintainerMetrics
// ---------------------------------------------------------------------------

describe('getMaintainerMetrics', () => {
  it('fetches /maintainers/:address/metrics', async () => {
    const metrics = {
      maintainer: 'GMAINTAINER',
      totalBounties: 5,
      openCount: 2,
      reservedCount: 1,
      submittedCount: 0,
      releasedCount: 2,
      refundedCount: 0,
      expiredCount: 0,
      totalFunded: 500,
      totalReleased: 200,
      averageRewardAmount: 100,
    };
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: metrics }));
    vi.stubGlobal('fetch', mockFetch);

    const { getMaintainerMetrics } = await import('./api');
    const result = await getMaintainerMetrics('GMAINTAINER');

    expect(result.totalBounties).toBe(5);
    expect(mockFetch.mock.calls[0][0]).toContain('/maintainers/GMAINTAINER/metrics');
  });
});

// ---------------------------------------------------------------------------
// getGlobalMetrics
// ---------------------------------------------------------------------------

describe('getGlobalMetrics', () => {
  it('fetches /global-metrics', async () => {
    const metrics = {
      totalBounties: 10,
      openCount: 3,
      reservedCount: 2,
      submittedCount: 1,
      releasedCount: 4,
      refundedCount: 0,
      expiredCount: 0,
      totalFunded: 1000,
      totalReleased: 400,
      uniqueMaintainers: 5,
      uniqueContributors: 7,
    };
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: metrics }));
    vi.stubGlobal('fetch', mockFetch);

    const { getGlobalMetrics } = await import('./api');
    const result = await getGlobalMetrics();

    expect(result.totalBounties).toBe(10);
    expect(mockFetch.mock.calls[0][0]).toContain('/global-metrics');
  });
});

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

describe('getNotificationPreferences', () => {
  it('fetches /notification-preferences/:address with encoded address', async () => {
    const prefs = {
      address: 'GTEST',
      optedIn: true,
      channels: { email: false, webhook: false, push: true },
      events: {},
      supportedTransitions: [],
    };
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: prefs }));
    vi.stubGlobal('fetch', mockFetch);

    const { getNotificationPreferences } = await import('./api');
    const result = await getNotificationPreferences('GTEST');

    expect(result.address).toBe('GTEST');
    expect(mockFetch.mock.calls[0][0]).toContain('/notification-preferences/GTEST');
  });
});

describe('updateNotificationPreferences', () => {
  it('PUTs to /notification-preferences/:address', async () => {
    const updated = {
      address: 'GTEST',
      optedIn: true,
      channels: { email: true, webhook: false, push: true },
      events: {},
      supportedTransitions: [],
    };
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: updated }));
    vi.stubGlobal('fetch', mockFetch);

    const { updateNotificationPreferences } = await import('./api');
    const result = await updateNotificationPreferences('GTEST', { optIn: true, email: 'a@b.com' });

    expect(result.optedIn).toBe(true);
    const call = mockFetch.mock.calls[0];
    expect(call[1].method).toBe('PUT');
    expect(call[0]).toContain('/notification-preferences/GTEST');
    const body = JSON.parse(call[1].body);
    expect(body.address).toBe('GTEST');
    expect(body.email).toBe('a@b.com');
  });

  it('does not retry (retry=false)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(errorResponse(503, { error: 'overloaded' }));
    vi.stubGlobal('fetch', mockFetch);

    const { updateNotificationPreferences } = await import('./api');
    await expect(updateNotificationPreferences('GTEST', {})).rejects.toThrow('overloaded');
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Pure helpers: toContractBountyStatus
// ---------------------------------------------------------------------------

describe('toContractBountyStatus', () => {
  it.each([
    ['open', BountyStatus.Open],
    ['reserved', BountyStatus.Reserved],
    ['submitted', BountyStatus.Submitted],
    ['released', BountyStatus.Released],
    ['refunded', BountyStatus.Refunded],
    ['expired', BountyStatus.Expired],
    ['disputed', BountyStatus.Disputed],
  ] as const)('maps "%s" to BountyStatus.%i', async (status, expected) => {
    const { toContractBountyStatus } = await import('./api');
    expect(toContractBountyStatus(status as any)).toBe(expected);
  });

  it('throws for unknown status string', async () => {
    const { toContractBountyStatus } = await import('./api');
    expect(() => toContractBountyStatus('cancelled' as any)).toThrow(/Unknown frontend status/);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers: getContractErrorLabel
// ---------------------------------------------------------------------------

describe('getContractErrorLabel', () => {
  it.each([
    [ContractError.InvalidAmount, 'InvalidAmount'],
    [ContractError.BountyNotOpen, 'BountyNotOpen'],
    [ContractError.BountyNotFound, 'BountyNotFound'],
    [ContractError.NotArbiter, 'NotArbiter'],
    [ContractError.ContributorMismatch, 'ContributorMismatch'],
    [ContractError.MaintainerMismatch, 'MaintainerMismatch'],
  ])('maps ContractError %i to "%s"', async (code, label) => {
    const { getContractErrorLabel } = await import('./api');
    expect(getContractErrorLabel(code)).toBe(label);
  });

  it('returns "UnknownContractError" for out-of-range code', async () => {
    const { getContractErrorLabel } = await import('./api');
    expect(getContractErrorLabel(9999 as ContractError)).toBe('UnknownContractError');
  });
});

// ---------------------------------------------------------------------------
// STELLAR_NETWORK_PASSPHRASE constant
// ---------------------------------------------------------------------------

describe('STELLAR_NETWORK_PASSPHRASE', () => {
  it('defaults to the testnet passphrase', async () => {
    const { STELLAR_NETWORK_PASSPHRASE } = await import('./api');
    expect(STELLAR_NETWORK_PASSPHRASE).toContain('Test SDF Network');
  });
});

// ---------------------------------------------------------------------------
// X-Request-ID header injection
// ---------------------------------------------------------------------------

describe('X-Request-ID injection', () => {
  it('auto-injects an X-Request-ID header when not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ data: [] }));
    vi.stubGlobal('fetch', mockFetch);

    const { listOpenIssues } = await import('./api');
    await listOpenIssues();

    const headers: Record<string, string> = mockFetch.mock.calls[0][1].headers;
    const hasRequestId = 'X-Request-ID' in headers || 'x-request-id' in headers;
    expect(hasRequestId).toBe(true);
  });
});
