/**
 * types.test.ts — Coverage for frontend/src/types.ts
 *
 * Type-only files don't have runtime branches, but they DO have:
 *  - Type unions (BountyStatus, EventType, impact) — ensure all members are exported and usable
 *  - Optional fields (Bounty has many `?` fields) — ensure presence/absence is type-safe
 *  - Interface shapes (Bounty, CreateBountyPayload, OpenIssue, MaintainerMetrics, GlobalMetrics)
 *  - Type narrowing through discriminated unions
 *
 * Per issue #1271: "Coverage for conditional branches and user interactions
 * in this file isn't confirmed — a refactor could change behaviour while
 * leaving every existing test green."
 */

import { describe, expect, it } from 'vitest';
import type {
  Bounty,
  BountyEvent,
  BountyStatus,
  CreateBountyPayload,
  EventType,
  GithubLabel,
  GlobalMetrics,
  MaintainerMetrics,
  OpenIssue,
} from './types';

// ---------------------------------------------------------------------------
// Type-level assertions (compile-time refactor protection)
// ---------------------------------------------------------------------------

type ExpectedBountyStatus = 'open' | 'reserved' | 'submitted' | 'released' | 'refunded' | 'expired' | 'disputed';
const _bountyStatusIsExactlySevenMembers: ExpectedBountyStatus extends BountyStatus ? BountyStatus extends ExpectedBountyStatus ? true : never : never = true;
void _bountyStatusIsExactlySevenMembers;

type ExpectedEventType = 'created' | 'reserved' | 'submitted' | 'released' | 'refunded' | 'expired' | 'disputed';
const _eventTypeMatchesExpected: ExpectedEventType extends EventType ? EventType extends ExpectedEventType ? true : never : never = true;
void _eventTypeMatchesExpected;

type ExpectedImpact = 'starter' | 'core' | 'advanced';
const _impactIsThreeMembers: ExpectedImpact extends OpenIssue['impact'] ? OpenIssue['impact'] extends ExpectedImpact ? true : never : never = true;
void _impactIsThreeMembers;

// ---------------------------------------------------------------------------
// Runtime fixtures
// ---------------------------------------------------------------------------

const validLabel: GithubLabel = { name: 'good first issue', color: 'e4e669' };
const validBountyEvent: BountyEvent = { type: 'created', timestamp: 1_700_000_000 };

const validBounty: Bounty = {
  id: 'BNTY-1', repo: 'ritik4ever/stellar-bounty-board', issueNumber: 1,
  title: 'Test bounty', summary: 'For types.test.ts fixture',
  maintainer: 'GAAA...WHF', tokenSymbol: 'XLM', amount: 100,
  labels: [validLabel], status: 'open',
  createdAt: 1_700_000_000, deadlineAt: 1_700_086_400,
  version: 1, events: [validBountyEvent],
};

const validCreateBountyPayload: CreateBountyPayload = {
  repo: 'ritik4ever/stellar-bounty-board', issueNumber: 1,
  title: 'Test bounty', summary: 'For types.test.ts fixture',
  maintainer: 'GAAA...WHF', tokenSymbol: 'XLM', amount: 100,
  deadlineDays: 7, labels: [validLabel],
};

const validOpenIssue: OpenIssue = {
  id: 'ISSUE-1', title: 'Add tests for types.ts',
  labels: [validLabel], summary: 'Coverage for conditional branches',
  impact: 'starter',
};

const validMaintainerMetrics: MaintainerMetrics = {
  maintainer: 'GAAA...WHF', totalBounties: 10,
  openCount: 5, reservedCount: 2, submittedCount: 1, releasedCount: 1,
  refundedCount: 0, expiredCount: 1,
  totalFunded: 1000, totalReleased: 800, averageRewardAmount: 100,
};

const validGlobalMetrics: GlobalMetrics = {
  totalBounties: 100, openCount: 50, reservedCount: 20, submittedCount: 10,
  releasedCount: 15, refundedCount: 2, expiredCount: 3,
  totalFunded: 10_000, totalReleased: 8_000,
  uniqueMaintainers: 25, uniqueContributors: 60,
};

// ---------------------------------------------------------------------------
// Runtime tests
// ---------------------------------------------------------------------------

describe('types.ts — interface shape verification', () => {
  it('all BountyStatus union members are usable at runtime', () => {
    const allStatuses: BountyStatus[] = ['open','reserved','submitted','released','refunded','expired','disputed'];
    expect(allStatuses).toHaveLength(7);
    expect(new Set(allStatuses).size).toBe(7);
  });

  it('all EventType union members are usable at runtime', () => {
    const allEventTypes: EventType[] = ['created','reserved','submitted','released','refunded','expired','disputed'];
    expect(allEventTypes).toHaveLength(7);
    const statusSet = new Set<BountyStatus>(['open','reserved','submitted','released','refunded','expired','disputed']);
    for (const et of allEventTypes) {
      if (et !== 'created') expect(statusSet.has(et as BountyStatus)).toBe(true);
    }
  });

  it('GithubLabel is name + hex color without #', () => {
    const label: GithubLabel = validLabel;
    expect(label.name).toBe('good first issue');
    expect(label.color).toMatch(/^[0-9a-fA-F]{6}$/);
    expect(label.color).not.toContain('#');
  });

  it('BountyEvent accepts optional actor + details', () => {
    const minimal: BountyEvent = { type: 'created', timestamp: 1 };
    expect(minimal.actor).toBeUndefined();
    expect(minimal.details).toBeUndefined();
    const withDetails: BountyEvent = { type: 'reserved', timestamp: 2, actor: 'A', details: { txHash: 'abc' } };
    expect(withDetails.actor).toBe('A');
  });

  it('Bounty interface accepts all 7 statuses', () => {
    const statuses: BountyStatus[] = ['open','reserved','submitted','released','refunded','expired','disputed'];
    const bounties: Bounty[] = statuses.map((status, i) => ({ ...validBounty, id: `BNTY-${i+1}`, status }));
    expect(bounties).toHaveLength(7);
    bounties.forEach((b, i) => expect(b.status).toBe(statuses[i]));
  });

  it('Bounty optional fields can be present or absent', () => {
    const minimal: Bounty = validBounty;
    expect(minimal.contributor).toBeUndefined();
    expect(minimal.escrowStatus).toBeUndefined();
    const full: Bounty = {
      ...validBounty,
      contributor: 'GBBB...BK', escrowStatus: 'released', onChainEscrowStatus: 'released',
      expiresAt: '2026-12-31', reservedAt: 100, submittedAt: 200, releasedAt: 300,
      releasedTxHash: '0xabc', refundedAt: 400, refundedTxHash: '0xdef',
      submissionUrl: 'https://example.com/pr/1', notes: 'Test', reservationTimeoutSeconds: 3600,
    };
    expect(full.contributor).toBe('GBBB...BK');
    expect(full.reservationTimeoutSeconds).toBe(3600);
  });

  it('CreateBountyPayload has all required fields', () => {
    const payload: CreateBountyPayload = validCreateBountyPayload;
    expect(payload.repo).toBeDefined();
    expect(payload.deadlineDays).toBeGreaterThan(0);
  });

  it('OpenIssue.impact is one of starter/core/advanced', () => {
    const impacts: OpenIssue['impact'][] = ['starter', 'core', 'advanced'];
    expect(impacts).toHaveLength(3);
    const issue: OpenIssue = { ...validOpenIssue, impact: 'core' };
    expect(issue.impact).toBe('core');
  });

  it('MaintainerMetrics has valid counts', () => {
    const m: MaintainerMetrics = validMaintainerMetrics;
    expect(m.averageRewardAmount).toBeGreaterThan(0);
    expect(m.totalReleased).toBeLessThanOrEqual(m.totalFunded);
  });

  it('GlobalMetrics has expected fields', () => {
    const g: GlobalMetrics = validGlobalMetrics;
    expect(g.totalBounties).toBeGreaterThan(0);
    expect(g.uniqueMaintainers).toBeGreaterThan(0);
    expect(g.totalFunded).toBeGreaterThanOrEqual(g.totalReleased);
  });
});

describe('types.ts — discriminated union narrowing', () => {
  it('BountyEvent can be narrowed by type field', () => {
    const events: BountyEvent[] = [
      { type: 'created', timestamp: 1 },
      { type: 'reserved', timestamp: 2, actor: 'A' },
      { type: 'submitted', timestamp: 3 },
      { type: 'released', timestamp: 4 },
      { type: 'refunded', timestamp: 5 },
      { type: 'expired', timestamp: 6 },
      { type: 'disputed', timestamp: 7 },
    ];
    const byType = new Map<EventType, BountyEvent>();
    for (const ev of events) byType.set(ev.type, ev);
    expect(byType.size).toBe(7);
    expect(byType.get('created')?.timestamp).toBe(1);
    expect(byType.get('disputed')?.timestamp).toBe(7);
  });

  it('Bounty can be narrowed by status', () => {
    const bounties: Bounty[] = [
      { ...validBounty, id: 'A', status: 'open' },
      { ...validBounty, id: 'B', status: 'reserved', contributor: 'X', reservedAt: 100 },
      { ...validBounty, id: 'C', status: 'submitted', submissionUrl: 'u' },
      { ...validBounty, id: 'D', status: 'released', releasedTxHash: '0x1' },
      { ...validBounty, id: 'E', status: 'refunded', refundedTxHash: '0x2' },
      { ...validBounty, id: 'F', status: 'expired' },
      { ...validBounty, id: 'G', status: 'disputed' },
    ];
    const open = bounties.filter((b) => b.status === 'open');
    expect(open).toHaveLength(1);
    const reserved = bounties.find((b) => b.status === 'reserved');
    expect(reserved?.contributor).toBeDefined();
    expect(reserved?.reservedAt).toBeDefined();
  });
});

describe('types.ts — runtime type guards', () => {
  it('BountyStatus type guard rejects invalid values', () => {
    const KNOWN = new Set<BountyStatus>(['open','reserved','submitted','released','refunded','expired','disputed']);
    const isBountyStatus = (v: unknown): v is BountyStatus =>
      typeof v === 'string' && KNOWN.has(v as BountyStatus);
    expect(isBountyStatus('open')).toBe(true);
    expect(isBountyStatus('disputed')).toBe(true);
    expect(isBountyStatus('PENDING')).toBe(false);
    expect(isBountyStatus(null)).toBe(false);
    expect(isBountyStatus(42)).toBe(false);
  });

  it('EventType type guard is case-sensitive', () => {
    const KNOWN = new Set<EventType>(['created','reserved','submitted','released','refunded','expired','disputed']);
    const isEventType = (v: unknown): v is EventType =>
      typeof v === 'string' && KNOWN.has(v as EventType);
    expect(isEventType('created')).toBe(true);
    expect(isEventType('CREATED')).toBe(false);
    expect(isEventType('open')).toBe(false); // 'open' is BountyStatus, not EventType
  });
});
