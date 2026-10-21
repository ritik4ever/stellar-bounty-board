export interface GithubLabel {
  name: string;
  color: string; // hex without '#', e.g. "e4e669"
}
export type BountyStatus =
  'open' | 'reserved' | 'submitted' | 'released' | 'refunded' | 'expired' | 'disputed';

export type EventType =
  | 'created'
  | 'reserved'
  | 'submitted'
  | 'released'
  | 'refunded'
  | 'expired'
  | 'disputed'
  | 'pr_merged';

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
  /** On-chain Soroban escrow status distinct from application lifecycle status (Issue #1452) */
  escrowStatus?: BountyStatus | string;
  onChainEscrowStatus?: BountyStatus | string;
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
  disputedAt?: number;
  disputeReason?: string;
  prMerged?: boolean;
  prMergedAt?: number;
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
}

export interface NotificationPreferences {
  address: string;
  optedIn: boolean;
  channels: {
    email: boolean;
    webhook: boolean;
    push: boolean;
  };
  events: Record<string, boolean>;
  preference?: {
    address: string;
    optIn: boolean;
    email?: string;
    webhookUrl?: string;
  };
  supportedTransitions: string[];
}

/**
 * Visual fetch and lifecycle status types for asynchronous data flows (#1270).
 */
export type AsyncDataStatus = 'idle' | 'loading' | 'empty' | 'error' | 'success';

/**
 * Base retry affordance interface for asynchronous views (#1270).
 */
export interface AsyncRetryAffordance {
  onRetry?: () => void;
}

/**
 * Structured async state container with status, payload, error, and retry affordance (#1270).
 */
export interface AsyncDataState<T> extends AsyncRetryAffordance {
  status: AsyncDataStatus;
  data?: T;
  error?: string | null;
  onRetry?: () => void;
}

/**
 * Discriminated union loading state (#1270).
 */
export interface AsyncLoadingState<T = unknown> extends AsyncRetryAffordance {
  status: 'loading';
  data?: T;
  error?: null;
}

/**
 * Discriminated union empty state (#1270).
 */
export interface AsyncEmptyState<T = unknown> extends AsyncRetryAffordance {
  status: 'empty';
  data?: T;
  error?: null;
}

/**
 * Discriminated union error state with retry affordance (#1270).
 */
export interface AsyncErrorState<T = unknown> extends AsyncRetryAffordance {
  status: 'error';
  error: string;
  data?: T;
  onRetry?: () => void;
}

/**
 * Discriminated union success state (#1270).
 */
export interface AsyncSuccessState<T> extends AsyncRetryAffordance {
  status: 'success';
  data: T;
  error?: null;
}

/**
 * Discriminated union representing visually distinct async data rendering states (#1270).
 */
export type AsyncViewState<T> =
  AsyncLoadingState<T> | AsyncEmptyState<T> | AsyncErrorState<T> | AsyncSuccessState<T>;

/**
 * Broad compatibility aliases (#1270, #1273).
 */
export type AsyncState<T> = AsyncDataState<T>;
export type AsyncFetchStatus = AsyncDataStatus;
export type AsyncFetchState<T> = AsyncDataState<T>;

/**
 * Runtime type guard for loading state (#1270).
 */
export function isLoadingState<T>(state: AsyncDataState<T>): state is AsyncLoadingState<T> {
  return state.status === 'loading';
}

/**
 * Runtime type guard for empty state (#1270).
 */
export function isEmptyState<T>(state: AsyncDataState<T>): state is AsyncEmptyState<T> {
  return state.status === 'empty';
}

/**
 * Runtime type guard for error state (#1270).
 */
export function isErrorState<T>(state: AsyncDataState<T>): state is AsyncErrorState<T> {
  return state.status === 'error';
}

/**
 * Runtime type guard for success state (#1270).
 */
export function isSuccessState<T>(state: AsyncDataState<T>): state is AsyncSuccessState<T> {
  return state.status === 'success';
}

/**
 * Determines the visual async data state given loading flags, error details, and records (#1270).
 */
export function resolveAsyncState<T>(
  data: T[] | null | undefined,
  loading: boolean,
  error?: string | null,
  onRetry?: () => void
): AsyncDataState<T[]> {
  if (loading) {
    return { status: 'loading', data: data ?? undefined, error: null, onRetry };
  }
  if (error) {
    return { status: 'error', data: data ?? undefined, error, onRetry };
  }
  if (!data || data.length === 0) {
    return { status: 'empty', data: [], error: null, onRetry };
  }
  return { status: 'success', data, error: null, onRetry };
}

export const resolveAsyncDataState = resolveAsyncState;
