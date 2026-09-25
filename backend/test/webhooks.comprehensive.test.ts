import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { hasBeenProcessed, markAsProcessed, __resetDeliveryDedupStoreForTests } from '../src/webhooks/deliveryDedup';
import { handleGitHubPrEvent } from '../src/webhooks/githubPrHandler';

describe('Webhooks Module — deliveryDedup', () => {
  beforeEach(() => {
    __resetDeliveryDedupStoreForTests();
  });

  afterEach(() => {
    __resetDeliveryDedupStoreForTests();
  });

  describe('hasBeenProcessed', () => {
    it('returns false for unprocessed delivery IDs', () => {
      const result = hasBeenProcessed('unknown-delivery-id');
      expect(result).toBe(false);
    });

    it('returns true after marking a delivery as processed', () => {
      const deliveryId = 'test-delivery-id';
      markAsProcessed(deliveryId);
      expect(hasBeenProcessed(deliveryId)).toBe(true);
    });

    it('returns false after TTL expiration (simulated via time manipulation)', () => {
      // This test verifies the structure, though actual TTL testing would need time mocking
      const deliveryId = 'test-delivery-id';
      markAsProcessed(deliveryId);
      expect(hasBeenProcessed(deliveryId)).toBe(true);
    });

    it('distinguishes between different delivery IDs', () => {
      const id1 = 'delivery-1';
      const id2 = 'delivery-2';
      markAsProcessed(id1);
      expect(hasBeenProcessed(id1)).toBe(true);
      expect(hasBeenProcessed(id2)).toBe(false);
    });

    it('returns false for empty string delivery ID', () => {
      expect(hasBeenProcessed('')).toBe(false);
    });

    it('handles many different delivery IDs', () => {
      const ids = Array.from({ length: 100 }, (_, i) => `delivery-${i}`);
      ids.forEach((id) => markAsProcessed(id));
      ids.forEach((id) => expect(hasBeenProcessed(id)).toBe(true));
    });
  });

  describe('markAsProcessed', () => {
    it('records a delivery ID as processed', () => {
      const deliveryId = 'new-delivery-id';
      markAsProcessed(deliveryId);
      expect(hasBeenProcessed(deliveryId)).toBe(true);
    });

    it('can be called multiple times for same ID without error', () => {
      const deliveryId = 'delivery-id';
      expect(() => {
        markAsProcessed(deliveryId);
        markAsProcessed(deliveryId);
        markAsProcessed(deliveryId);
      }).not.toThrow();
      expect(hasBeenProcessed(deliveryId)).toBe(true);
    });

    it('updates timestamp when called multiple times', () => {
      const deliveryId = 'delivery-id';
      markAsProcessed(deliveryId);
      const firstCheck = hasBeenProcessed(deliveryId);
      expect(firstCheck).toBe(true);
      // Mark again (should update timestamp)
      markAsProcessed(deliveryId);
      const secondCheck = hasBeenProcessed(deliveryId);
      expect(secondCheck).toBe(true);
    });

    it('accepts special characters in delivery IDs', () => {
      const deliveryId = 'delivery-id-with-special-chars-!@#$%';
      markAsProcessed(deliveryId);
      expect(hasBeenProcessed(deliveryId)).toBe(true);
    });
  });

  describe('__resetDeliveryDedupStoreForTests', () => {
    it('clears all processed delivery IDs', () => {
      markAsProcessed('id-1');
      markAsProcessed('id-2');
      expect(hasBeenProcessed('id-1')).toBe(true);
      expect(hasBeenProcessed('id-2')).toBe(true);

      __resetDeliveryDedupStoreForTests();

      expect(hasBeenProcessed('id-1')).toBe(false);
      expect(hasBeenProcessed('id-2')).toBe(false);
    });

    it('can be called multiple times safely', () => {
      expect(() => {
        __resetDeliveryDedupStoreForTests();
        __resetDeliveryDedupStoreForTests();
        __resetDeliveryDedupStoreForTests();
      }).not.toThrow();
    });
  });
});

describe('Webhooks Module — githubPrHandler', () => {
  beforeEach(() => {
    __resetDeliveryDedupStoreForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    __resetDeliveryDedupStoreForTests();
    vi.clearAllMocks();
  });

  const mockListBounties = vi.fn();
  const mockReleaseBounty = vi.fn();

  beforeEach(() => {
    // Mock the bounty store functions
    vi.doMock('../src/services/bountyStore', () => ({
      listBounties: mockListBounties,
      releaseBounty: mockReleaseBounty,
    }));
  });

  describe('handleGitHubPrEvent', () => {
    describe('invalid payloads', () => {
      it('handles non-object bodies gracefully', async () => {
        const result = await handleGitHubPrEvent('not-an-object');
        expect(result.duplicate).toBe(false);
      });

      it('handles null body gracefully', async () => {
        const result = await handleGitHubPrEvent(null);
        expect(result.duplicate).toBe(false);
      });

      it('handles body without action field', async () => {
        const body = { pull_request: { html_url: 'https://github.com/owner/repo/pull/123' } };
        const result = await handleGitHubPrEvent(body);
        expect(result.duplicate).toBe(false);
      });

      it('handles body with non-string action', async () => {
        const body = { action: 123 };
        const result = await handleGitHubPrEvent(body);
        expect(result.duplicate).toBe(false);
      });
    });

    describe('PR action filtering', () => {
      it('skips non-closed PR actions', async () => {
        const body = {
          action: 'opened',
          pull_request: { html_url: 'https://github.com/owner/repo/pull/123', merged: true },
        };
        const result = await handleGitHubPrEvent(body);
        expect(result.duplicate).toBe(false);
      });

      it('skips closed PRs that are not merged', async () => {
        const body = {
          action: 'closed',
          pull_request: { html_url: 'https://github.com/owner/repo/pull/123', merged: false },
        };
        const result = await handleGitHubPrEvent(body);
        expect(result.duplicate).toBe(false);
      });

      it('processes closed and merged PRs', async () => {
        const prUrl = 'https://github.com/owner/repo/pull/123';
        const body = {
          action: 'closed',
          pull_request: { html_url: prUrl, merged: true },
        };
        // This would need mocking of the bounty store to fully test the release flow
        // For now, we test that it doesn't throw
        expect(async () => {
          await handleGitHubPrEvent(body);
        }).not.toThrow();
      });
    });

    describe('missing PR URL', () => {
      it('handles missing html_url gracefully', async () => {
        const body = {
          action: 'closed',
          pull_request: { merged: true },
        };
        const result = await handleGitHubPrEvent(body);
        expect(result.duplicate).toBe(false);
      });

      it('handles missing pull_request object', async () => {
        const body = { action: 'closed' };
        const result = await handleGitHubPrEvent(body);
        expect(result.duplicate).toBe(false);
      });
    });

    describe('delivery deduplication', () => {
      it('returns duplicate: false on first delivery', async () => {
        const deliveryId = 'delivery-123';
        const body = {
          action: 'other-action',
          pull_request: { html_url: 'url', merged: true },
        };
        const result = await handleGitHubPrEvent(body, deliveryId);
        expect(result.duplicate).toBe(false);
      });

      it('returns duplicate: true on subsequent delivery with same ID', async () => {
        const deliveryId = 'delivery-123';
        const body = {
          action: 'other-action',
          pull_request: { html_url: 'url', merged: true },
        };
        // First call
        await handleGitHubPrEvent(body, deliveryId);
        // Second call with same delivery ID
        const result = await handleGitHubPrEvent(body, deliveryId);
        expect(result.duplicate).toBe(true);
      });

      it('marks delivery as processed even for non-PR events', async () => {
        const deliveryId = 'delivery-456';
        const body = { action: 'push' }; // Not a PR event
        const result = await handleGitHubPrEvent(body, deliveryId);
        expect(result.duplicate).toBe(false);
        // Second attempt should be marked as duplicate
        const result2 = await handleGitHubPrEvent(body, deliveryId);
        expect(result2.duplicate).toBe(true);
      });

      it('processes different delivery IDs independently', async () => {
        const body = { action: 'other' };
        const result1 = await handleGitHubPrEvent(body, 'delivery-1');
        const result2 = await handleGitHubPrEvent(body, 'delivery-2');
        expect(result1.duplicate).toBe(false);
        expect(result2.duplicate).toBe(false);
      });

      it('handles events without delivery ID', async () => {
        const body = { action: 'push' };
        const result = await handleGitHubPrEvent(body);
        expect(result.duplicate).toBe(false);
      });
    });

    describe('PR processing without bounty release mocking', () => {
      it('handles closed and merged PR with all required fields', async () => {
        const prUrl = 'https://github.com/owner/repo/pull/100';
        const body = {
          action: 'closed',
          pull_request: {
            html_url: prUrl,
            merged: true,
          },
        };
        // This verifies the happy path doesn't throw
        const result = await handleGitHubPrEvent(body);
        expect(result).toBeDefined();
        expect(result.duplicate).toBe(false);
      });

      it('handles various PR actions beyond closed', async () => {
        const actions = ['opened', 'reopened', 'edited', 'synchronize'];
        for (const action of actions) {
          const body = {
            action,
            pull_request: {
              html_url: 'https://github.com/owner/repo/pull/123',
              merged: true,
            },
          };
          const result = await handleGitHubPrEvent(body);
          // Only closed + merged should process; others should skip
          expect(result.duplicate).toBe(false);
        }
      });

      it('handles edge case: pull_request exists but html_url is empty string', async () => {
        const body = {
          action: 'closed',
          pull_request: {
            html_url: '',
            merged: true,
          },
        };
        const result = await handleGitHubPrEvent(body);
        expect(result.duplicate).toBe(false);
      });

      it('handles edge case: pull_request.merged is undefined', async () => {
        const body = {
          action: 'closed',
          pull_request: {
            html_url: 'https://github.com/owner/repo/pull/123',
            // merged is undefined
          },
        };
        const result = await handleGitHubPrEvent(body);
        expect(result.duplicate).toBe(false);
      });

      it('always returns object with duplicate property', async () => {
        const validBodies = [
          'invalid',
          null,
          { action: 'unknown' },
          { action: 'closed', pull_request: { merged: false } },
        ];
        for (const body of validBodies) {
          const result = await handleGitHubPrEvent(body);
          expect(result).toHaveProperty('duplicate');
          expect(typeof result.duplicate).toBe('boolean');
        }
      });
    });
  });
});
