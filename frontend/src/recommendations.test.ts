import { describe, expect, it } from 'vitest';

import {
  countLabelOverlap,
  createDefaultProfile,
  generateRecommendations,
  getFallbackRecommendations,
  scoreMatch,
  updateProfileFromBounties,
} from './recommendations';
import type { Bounty } from './types';

const CONTRIBUTOR = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

function makeBounty(overrides: Partial<Bounty> & Pick<Bounty, 'id' | 'title' | 'amount' | 'labels'>): Bounty {
  return {
    repo: 'ritik4ever/stellar-bounty-board',
    issueNumber: 1,
    summary: 'Summary',
    maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    tokenSymbol: 'XLM',
    status: 'open',
    createdAt: 1_700_000_000,
    deadlineAt: 9_999_999_999,
    version: 1,
    events: [],
    ...overrides,
  };
}

const completedReactBounty = makeBounty({
  id: 'BNTY-DONE',
  title: 'Ship React filters',
  amount: 100,
  labels: [{ name: 'react', color: '61dafb' }, { name: 'frontend', color: '0075ca' }],
  status: 'released',
  contributor: CONTRIBUTOR,
});

describe('scoreMatch', () => {
  it('scores matching contributor skills against bounty text', () => {
    const bounty = makeBounty({
      id: 'BNTY-300',
      title: 'Add keyboard navigation',
      amount: 150,
      summary: 'Improve React accessibility for keyboard-only users.',
      labels: [{ name: 'accessibility', color: '0e8a16' }],
    });

    expect(scoreMatch(bounty, ['React', 'accessibility'])).toBe(1);
  });
});

describe('countLabelOverlap', () => {
  it('counts shared labels case-insensitively', () => {
    const bounty = makeBounty({
      id: 'BNTY-1',
      title: 'React task',
      amount: 50,
      labels: [{ name: 'React', color: '111111' }, { name: 'docs', color: '222222' }],
    });

    expect(countLabelOverlap(bounty, ['react', 'typescript'])).toBe(1);
  });
});

describe('getFallbackRecommendations', () => {
  it('returns highest-value open bounties when contributor has no history', () => {
    const bounties = [
      makeBounty({ id: 'low', title: 'Low', amount: 50, labels: [] }),
      makeBounty({ id: 'high', title: 'High', amount: 500, labels: [] }),
      makeBounty({ id: 'mid', title: 'Mid', amount: 200, labels: [] }),
      makeBounty({ id: 'closed', title: 'Closed', amount: 900, labels: [], status: 'released' }),
    ];

    const recommendations = getFallbackRecommendations(bounties, 3);

    expect(recommendations).toHaveLength(3);
    expect(recommendations.map((entry) => entry.bounty.id)).toEqual(['high', 'mid', 'low']);
    expect(recommendations[0]?.reasons[0]).toMatch(/Top open bounty/i);
  });
});

describe('generateRecommendations', () => {
  it('falls back to highest-value open bounties when contributor has no history', () => {
    const bounties = [
      makeBounty({ id: 'low', title: 'Low', amount: 75, labels: [] }),
      makeBounty({ id: 'high', title: 'High', amount: 400, labels: [] }),
    ];

    const profile = createDefaultProfile();
    const recommendations = generateRecommendations(bounties, profile, 3);

    expect(recommendations).toHaveLength(2);
    expect(recommendations[0]?.bounty.id).toBe('high');
  });

  it('recommends open bounties with a single matching label', () => {
    const bounties = [
      completedReactBounty,
      makeBounty({
        id: 'match',
        title: 'React dashboard',
        amount: 120,
        labels: [{ name: 'react', color: '61dafb' }],
      }),
      makeBounty({
        id: 'other',
        title: 'Python API',
        amount: 300,
        labels: [{ name: 'python', color: '3572a5' }],
      }),
    ];

    const profile = updateProfileFromBounties(createDefaultProfile(), [completedReactBounty]);
    const recommendations = generateRecommendations(bounties, profile, 3);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.bounty.id).toBe('match');
  });

  it('ranks multi-label matches ahead of single-label matches', () => {
    const bounties = [
      completedReactBounty,
      makeBounty({
        id: 'single',
        title: 'React only',
        amount: 500,
        labels: [{ name: 'react', color: '61dafb' }],
      }),
      makeBounty({
        id: 'multi',
        title: 'React frontend panel',
        amount: 100,
        labels: [
          { name: 'react', color: '61dafb' },
          { name: 'frontend', color: '0075ca' },
        ],
      }),
    ];

    const profile = updateProfileFromBounties(createDefaultProfile(), [completedReactBounty]);
    const recommendations = generateRecommendations(bounties, profile, 3);

    expect(recommendations.map((entry) => entry.bounty.id)).toEqual(['multi', 'single']);
    expect(recommendations[0]?.reasons[0]).toMatch(/2 labels/i);
  });

  it('returns at most three recommendations', () => {
    const bounties = Array.from({ length: 5 }, (_, index) =>
      makeBounty({
        id: `open-${index}`,
        title: `Open ${index}`,
        amount: 100 + index,
        labels: [],
      })
    );

    const recommendations = generateRecommendations(bounties, createDefaultProfile(), 3);

    expect(recommendations).toHaveLength(3);
  });
});
