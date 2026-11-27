import { describe, expect, it } from 'vitest';

import {
  calculateRecommendationScore,
  countLabelOverlap,
  createDefaultProfile,
  findSimilarBounties,
  generateRecommendations,
  getFallbackRecommendations,
  scoreMatch,
  updateProfileFromBounties,
} from './recommendations';
import type { Bounty } from './types';

const CONTRIBUTOR = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

function makeBounty(
  overrides: Partial<Bounty> & Pick<Bounty, 'id' | 'title' | 'amount' | 'labels'>
): Bounty {
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
  labels: [
    { name: 'react', color: '61dafb' },
    { name: 'frontend', color: '0075ca' },
  ],
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
      labels: [
        { name: 'React', color: '111111' },
        { name: 'docs', color: '222222' },
      ],
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

describe('calculateRecommendationScore branches', () => {
  it('covers preferred repo, reward range, and good first issue branches', () => {
    const bounty = makeBounty({
      id: 'bounty-full',
      repo: 'stellar/soroban-examples',
      title: 'First issue',
      amount: 250,
      labels: [{ name: 'good first issue', color: '111' }],
      status: 'open',
    });

    const profile: any = {
      completedLabels: [],
      preferredRepos: ['stellar/soroban-examples'],
      averageRewardRange: { min: 100, max: 500 },
      skills: ['soroban'],
    };

    const result = calculateRecommendationScore(bounty, profile);
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons).toContain('Great for getting started');
    expect(result.reasons).toContain("You're familiar with stellar/soroban-examples");
    expect(result.reasons).toContain('Reward matches your typical range');
  });

  it('assigns zero score to non-open bounties', () => {
    const bounty = makeBounty({
      id: 'bounty-closed',
      title: 'Closed issue',
      amount: 100,
      labels: [{ name: 'documentation', color: '111' }],
      status: 'released',
    });

    const profile: any = {
      completedLabels: ['documentation'],
      preferredRepos: [],
      averageRewardRange: { min: 0, max: 1000 },
      skills: [],
    };

    const result = calculateRecommendationScore(bounty, profile);
    expect(result.score).toBe(0);
  });
});

describe('findSimilarBounties', () => {
  it('finds similar bounties excluding the target and sorting by score', () => {
    const target = makeBounty({
      id: 'target-bounty',
      title: 'React components',
      amount: 100,
      labels: [{ name: 'React', color: '111' }],
    });

    const candidates = [
      target,
      makeBounty({
        id: 'candidate-1',
        title: 'React navigation',
        amount: 120,
        labels: [{ name: 'React', color: '111' }],
        status: 'open',
      }),
      makeBounty({
        id: 'candidate-closed',
        title: 'React forms',
        amount: 150,
        labels: [{ name: 'React', color: '111' }],
        status: 'released',
      }),
    ];

    const similar = findSimilarBounties(target, candidates, 2);
    expect(similar.some((s) => s.bounty.id === 'target-bounty')).toBe(false);
    expect(similar.some((s) => s.bounty.id === 'candidate-closed')).toBe(false);
    expect(similar[0]?.bounty.id).toBe('candidate-1');
  });
});

describe('updateProfileFromBounties skills inference', () => {
  it('infers Docs, Node.js, and other skills from released bounties', () => {
    const defaultProfile = createDefaultProfile();
    const bounties = [
      makeBounty({
        id: 'b-1',
        title: 'Docs update',
        amount: 50,
        labels: [{ name: 'docs', color: '111' }],
        status: 'released',
      }),
      makeBounty({
        id: 'b-2',
        title: 'Node server',
        amount: 300,
        labels: [{ name: 'node.js', color: '222' }],
        status: 'released',
      }),
    ];

    const updated = updateProfileFromBounties(defaultProfile, bounties);
    expect(updated.skills).toContain('Docs');
    expect(updated.skills).toContain('Node.js');
    expect(updated.averageRewardRange.min).toBe(50);
    expect(updated.averageRewardRange.max).toBe(300);
  });
});
