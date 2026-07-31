import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSocialMetaTags } from './metaTags';
import type { Bounty } from './types';

describe('updateSocialMetaTags', () => {
  const originalOrigin = window.location.origin;

  beforeEach(() => {
    document.head.innerHTML = '';

    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      origin: 'https://stellar-bounty.com',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      origin: originalOrigin,
    });
  });

  it('should set default meta tags when bounty is null', () => {
    updateSocialMetaTags(null);

    expect(document.title).toBe('Stellar Bounty Board');
    expect(getMetaContent('og:title')).toBe('Stellar Bounty Board');
    expect(getMetaContent('og:description')).toBe('Fund GitHub issues with on-chain style escrow');
    expect(getMetaContent('og:url')).toBe('https://stellar-bounty.com');
    expect(getMetaContent('og:type')).toBe('website');
    expect(getMetaContent('twitter:card')).toBe('summary');
    expect(getMetaContent('twitter:title')).toBe('Stellar Bounty Board');
    expect(getMetaContent('twitter:description')).toBe(
      'Fund GitHub issues with on-chain style escrow'
    );
  });

  it('should update meta tags with bounty data', () => {
    const mockBounty = createMockBounty({
      id: 'bounty-123',
      repo: 'stellar/soroban-example',
      issueNumber: 42,
      title: 'Add authentication feature',
      summary: 'Implement OAuth2 authentication for the API',
      amount: 500,
    });

    updateSocialMetaTags(mockBounty);

    expect(document.title).toBe('Add authentication feature | Stellar Bounty Board');
    expect(getMetaContent('og:title')).toBe('Add authentication feature');
    expect(getMetaContent('og:description')).toBe(
      'Implement OAuth2 authentication for the API • Reward: 500 XLM'
    );
    expect(getMetaContent('og:url')).toBe('https://stellar-bounty.com/bounties/bounty-123');
    expect(getMetaContent('og:type')).toBe('article');
    expect(getMetaContent('og:image')).toBe('https://github.com/stellar.png?size=400');
    expect(getMetaContent('twitter:card')).toBe('summary');
    expect(getMetaContent('twitter:title')).toBe('Add authentication feature');
    expect(getMetaContent('twitter:description')).toBe(
      'Implement OAuth2 authentication for the API • Reward: 500 XLM'
    );
    expect(getMetaContent('twitter:image')).toBe('https://github.com/stellar.png?size=400');
  });

  it('should handle special characters in bounty ID', () => {
    const mockBounty = createMockBounty({
      id: 'bounty/with/slashes',
      repo: 'owner/repo',
      issueNumber: 1,
      title: 'Test',
      summary: 'Test summary',
      amount: 100,
    });

    updateSocialMetaTags(mockBounty);

    expect(getMetaContent('og:url')).toBe(
      'https://stellar-bounty.com/bounties/bounty%2Fwith%2Fslashes'
    );
  });

  it('should update existing meta tags instead of creating duplicates', () => {
    const mockBounty = createMockBounty({
      id: 'bounty-1',
      repo: 'owner/repo',
      issueNumber: 1,
      title: 'First Title',
      summary: 'First summary',
      amount: 100,
    });

    updateSocialMetaTags(mockBounty);

    expect(document.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);

    updateSocialMetaTags({
      ...mockBounty,
      title: 'Second Title',
    });

    expect(document.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(getMetaContent('og:title')).toBe('Second Title');
  });

  it('should remove image tags when resetting to default', () => {
    const mockBounty = createMockBounty({
      id: 'bounty-1',
      repo: 'owner/repo',
      issueNumber: 1,
      title: 'Test',
      summary: 'Test summary',
      amount: 100,
    });

    updateSocialMetaTags(mockBounty);
    expect(getMetaContent('og:image')).toBeTruthy();

    updateSocialMetaTags(null);

    expect(getMetaContent('og:image')).toBeNull();
    expect(getMetaContent('twitter:image')).toBeNull();
  });
});

function createMockBounty(overrides: Partial<Bounty>): Bounty {
  return {
    id: 'bounty-1',
    repo: 'owner/repo',
    issueNumber: 1,
    title: 'Test',
    summary: 'Test summary',
    maintainer: 'GABC123',
    tokenSymbol: 'XLM',
    amount: 100,
    labels: [],
    status: 'open',
    createdAt: 1234567890,
    deadlineAt: 1234567890,
    version: 1,
    events: [],
    ...overrides,
  };
}

function getMetaContent(property: string): string | null {
  const isOgTag = property.startsWith('og:');
  const selector = isOgTag ? `meta[property="${property}"]` : `meta[name="${property}"]`;
  const metaTag = document.querySelector(selector);

  return metaTag ? metaTag.getAttribute('content') : null;
}
