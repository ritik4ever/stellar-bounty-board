export interface GithubLabel {
  name: string;
  color: string; // hex without '#', e.g. "e4e669"
}
export type BountyStatus =
  | 'open'
  | 'reserved'
  | 'submitted'
  | 'released'
  | 'refunded'
  | 'expired'
  | 'disputed';

export type EventType =
  | 'created'
  | 'reserved'
  | 'submitted'
  | 'released'
  | 'refunded'
  | 'expired'
  | 'disputed';

export interface BountyEvent {
  type: EventType;
  timestamp: number;
  actor?: string;
  details?: Record<string, unknown>;
}

export interface Bounty {
  id: string;
  repo: string;
  issueNumber: number;
  title: string;
  summary: string;
  maintainer: string;
  contributor?: string;
  tokenSymbol: string;
  tokenAddress?: string;
  amount: number;
  labels: GithubLabel[];
  tags?: string[];

  status: BountyStatus;
  createdAt: number;
  deadlineAt: number;
  /** ISO 8601 date string representing when the bounty expires. Added in Wave 4. */
  expiresAt?: string;
  reservedAt?: number;
  submittedAt?: number;
  releasedAt?: number;
  releasedTxHash?: string;
  refundedAt?: number;
  refundedTxHash?: string;
  submissionUrl?: string;
  notes?: string;
  version: number;
  events: BountyEvent[];
  reservationTimeoutSeconds?: number;
}

export interface CreateBountyPayload {
  repo: string;
  issueNumber: number;
  title: string;
  summary: string;
  maintainer: string;
  tokenSymbol: string;
  amount: number;
  deadlineDays: number;
  labels: GithubLabel[];
}

export interface OpenIssue {
  id: string;
  title: string;
  labels: GithubLabel[];
  summary: string;
  impact: 'starter' | 'core' | 'advanced';
}

export interface MaintainerMetrics {
  maintainer: string;
  totalBounties: number;
  openCount: number;
  reservedCount: number;
  submittedCount: number;
  releasedCount: number;
  refundedCount: number;
  expiredCount: number;
  totalFunded: number;
  totalReleased: number;
  averageRewardAmount: number;
}

export interface GlobalMetrics {
  totalBounties: number;
  openCount: number;
  reservedCount: number;
  submittedCount: number;
  releasedCount: number;
  refundedCount: number;
  expiredCount: number;
  totalFunded: number;
  totalReleased: number;
  uniqueMaintainers: number;
  uniqueContributors: number;
  /** Cumulative protocol fees collected across released bounties (#1458). */
  protocolFeesCollected?: number;
}

/** Coarse trust tier derived from a contributor's completed-bounty count (#1459). */
export type ReputationLevel = 'rising' | 'trusted' | 'veteran';

export interface ContributorReputation {
  address: string;
  /**
   * Completed (released) bounty count, or `null` for first-time contributors.
   * `null` — never `0` — so the UI can hide the badge instead of implying a
   * bad track record.
   */
  reputation: number | null;
  releasedCount: number;
  totalEarned: number;
  level: ReputationLevel | null;
  isFirstTime: boolean;
}
