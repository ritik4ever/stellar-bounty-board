import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkBountyAction,
  createBounty,
  disputeBounty,
  exportReleasedPayoutsCsv,
  extendDeadline,
  getBounty,
  getBountyEvents,
  getContractErrorLabel,
  getGlobalMetrics,
  getMaintainerMetrics,
  listBounties,
  listOpenIssues,
  refundBounty,
  refundBountySigned,
  releaseBounty,
  releaseBountySigned,
  reserveBounty,
  resolveDisputeBounty,
  submitBounty,
  toContractBountyStatus,
} from './api';
import { BountyStatus as ContractBountyStatus, ContractError } from './generated';
import type { Bounty, CreateBountyPayload } from './types';

const mockBounty: Bounty = {
  id: 'bounty-1',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 1,
  title: 'Test Bounty',
  summary: 'Summary',
  amount: 100,
  maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  tokenSymbol: 'XLM',
  status: 'open',
  createdAt: 1700000000,
  deadlineAt: 1800000000,
  labels: [{ name: 'frontend', color: 'blue' }],
  version: 1,
  events: [],
};

describe('API client module', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('REST endpoints data fetching', () => {
    it('listBounties sends GET to /bounties and returns data array', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [mockBounty] }),
      } as Response);

      const result = await listBounties();
      expect(result).toEqual([mockBounty]);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/bounties'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Request-ID': expect.any(String),
          }),
        })
      );
    });

    it('getBounty retrieves individual bounty by id', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockBounty }),
      } as Response);

      const result = await getBounty('bounty-1');
      expect(result).toEqual(mockBounty);
    });

    it('createBounty posts payload and returns created item', async () => {
      const payload: CreateBountyPayload = {
        repo: 'ritik4ever/stellar-bounty-board',
        issueNumber: 10,
        title: 'New Issue',
        summary: 'Details',
        amount: 200,
        tokenSymbol: 'XLM',
        deadlineDays: 7,
        maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        labels: [],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { ...mockBounty, amount: 200 } }),
      } as Response);

      const result = await createBounty(payload);
      expect(result.amount).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/bounties'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload),
        })
      );
    });

    it('reserveBounty calls reserve endpoint with expectedVersion', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { ...mockBounty, status: 'reserved' } }),
      } as Response);

      const result = await reserveBounty('bounty-1', 'GCONTRIBUTOR', 1);
      expect(result.status).toBe('reserved');
    });

    it('submitBounty sends submissionUrl and notes', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { ...mockBounty, status: 'submitted' } }),
      } as Response);

      const result = await submitBounty('bounty-1', 'GCONTRIBUTOR', 'https://github.com/pr/1', 'Fixed bug');
      expect(result.status).toBe('submitted');
    });

    it('releaseBountySigned includes stellar signature headers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { ...mockBounty, status: 'released' } }),
      } as Response);

      const payload = {
        maintainer: 'GMAINTAINER',
        action: 'release' as const,
        bountyId: 'bounty-1',
        timestamp: Date.now(),
      };

      const result = await releaseBountySigned('bounty-1', payload, 'sig123', 'pubkey123');
      expect(result.status).toBe('released');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/bounties/bounty-1/release'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-stellar-signature': 'sig123',
            'x-stellar-public-key': 'pubkey123',
          }),
        })
      );
    });

    it('refundBountySigned includes stellar signature headers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { ...mockBounty, status: 'refunded' } }),
      } as Response);

      const payload = {
        maintainer: 'GMAINTAINER',
        action: 'refund' as const,
        bountyId: 'bounty-1',
        timestamp: Date.now(),
      };

      const result = await refundBountySigned('bounty-1', payload, 'sig123', 'pubkey123');
      expect(result.status).toBe('refunded');
    });

    it('disputeBounty and resolveDisputeBounty trigger dispute lifecycle', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockBounty }),
      } as Response);

      await disputeBounty('bounty-1', 'GCONTRIBUTOR', 'Incomplete requirements');
      await resolveDisputeBounty('bounty-1', 'GARBITER', true, 'txhash123');
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('bulkBountyAction passes admin header and returns bulk results', async () => {
      const bulkResponse = {
        action: 'release' as const,
        results: [{ bountyId: 'bounty-1', success: true }],
        succeeded: 1,
        failed: 0,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: bulkResponse }),
      } as Response);

      const result = await bulkBountyAction('release', ['bounty-1'], 'GMAINTAINER', 'secret-admin-key');
      expect(result.succeeded).toBe(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/bounties/bulk-action'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-admin-api-key': 'secret-admin-key',
          }),
        })
      );
    });

    it('extendDeadline sends new deadline timestamp', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockBounty }),
      } as Response);

      const result = await extendDeadline('bounty-1', 'GMAINTAINER', 1900000000);
      expect(result).toEqual(mockBounty);
    });

    it('listOpenIssues, getBountyEvents, getMaintainerMetrics, getGlobalMetrics', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response);

      await listOpenIssues();
      await getBountyEvents('bounty-1');
      await getMaintainerMetrics('GMAINTAINER');
      await getGlobalMetrics();
      expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    });

    it('exportReleasedPayoutsCsv parses blob and filename correctly', async () => {
      const mockBlob = new Blob(['payout,data'], { type: 'text/csv' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-disposition': 'attachment; filename="payouts_2026.csv"',
        }),
        blob: async () => mockBlob,
      } as unknown as Response);

      const result = await exportReleasedPayoutsCsv();
      expect(result.filename).toBe('payouts_2026.csv');
      expect(result.blob).toBeDefined();
    });
  });

  describe('Contract & Enum Helpers', () => {
    it('toContractBountyStatus maps status string to contract enum', () => {
      expect(toContractBountyStatus('open')).toBe(ContractBountyStatus.Open);
      expect(toContractBountyStatus('reserved')).toBe(ContractBountyStatus.Reserved);
      expect(toContractBountyStatus('released')).toBe(ContractBountyStatus.Released);
    });

    it('getContractErrorLabel translates contract error enums', () => {
      expect(getContractErrorLabel(ContractError.BountyNotFound)).toBe('Bounty not found');
      expect(getContractErrorLabel(ContractError.Unauthorized)).toBe('Unauthorized');
      expect(getContractErrorLabel(9999 as unknown as ContractError)).toBe('UnknownContractError');
    });
  });

  describe('Error handling & Retry logic', () => {
    it('throws immediately on non-retryable 400 error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid bounty id' }),
      } as Response);

      await expect(getBounty('bad-id')).rejects.toThrow('Invalid bounty id');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
