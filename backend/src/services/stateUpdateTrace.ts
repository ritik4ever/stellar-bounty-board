import crypto from 'node:crypto';
import { logger } from '../logger';
import type { BountyStatus, BountyTransitionType } from './bountyStore';

/**
 * Event identifier for concurrent bounty state update tracing (#1928).
 */
export const STATE_UPDATE_TRACE_EVENT = 'concurrent_bounty_state_update';

/**
 * Valid outcomes for a state update attempt.
 *
 * - `pending`: The transition has been initiated or claimed by a worker but is not yet durably committed.
 * - `committed`: The transition, monotonic version increment, and audit record have been persisted to disk.
 * - `failed`: The transition was rejected or aborted (e.g. version conflict, precondition failure).
 */
export const STATE_UPDATE_OUTCOMES = {
  pending: 'pending',
  committed: 'committed',
  failed: 'failed',
} as const;

export type StateUpdateOutcome = (typeof STATE_UPDATE_OUTCOMES)[keyof typeof STATE_UPDATE_OUTCOMES];

/**
 * Options passed to transitions allowing callers/workers to inject correlation references or custom sinks.
 */
export interface TransitionOptions {
  /** Optional raw or pre-redacted event reference (e.g., event ID, UUID). */
  eventRef?: string;
  /** Optional raw or pre-redacted delivery reference (e.g., GitHub delivery ID). */
  deliveryRef?: string;
  /** Optional raw or pre-redacted cursor reference (e.g., Soroban indexer cursor token). */
  cursorRef?: string;
  /** Optional identifier for the worker executing the transition. */
  workerId?: string;
  /** Optional custom trace emitter for capturing or redirecting trace logs. */
  trace?: StateUpdateTraceEmitter;
}

/**
 * Input parameters for building a structured state update trace record.
 */
export interface StateUpdateTraceInput {
  outcome: StateUpdateOutcome;
  bountyId?: string | null;
  transition: BountyTransitionType | string;
  eventRef?: string | null;
  deliveryRef?: string | null;
  cursorRef?: string | null;
  expectedVersion?: number | null;
  currentVersion?: number | null;
  fromStatus?: BountyStatus | string | null;
  toStatus?: BountyStatus | string | null;
  actor?: string | null;
  actorRef?: string | null;
  workerId?: string | null;
  error?: string | null;
  reason?: string | null;
  at?: string;
}

/**
 * Formatted and redacted state update trace record emitted to logs/sinks.
 */
export interface StateUpdateTraceRecord {
  event: typeof STATE_UPDATE_TRACE_EVENT;
  outcome: StateUpdateOutcome;
  at: string;
  bountyId: string;
  transition: string;
  eventRef: string;
  deliveryRef: string | null;
  cursorRef: string | null;
  expectedVersion: number | null;
  currentVersion: number | null;
  fromStatus: string | null;
  toStatus: string | null;
  actorRef: string | null;
  workerId: string | null;
  error: string | null;
  reason: string | null;
}

/**
 * Maps any raw token, ID, secret, or cursor to a stable, redacted SHA-256 reference.
 *
 * Emits a truncated SHA-256 digest (`sha256:` + 16 hex chars) so operators can correlate
 * events without exposing raw keys, secrets, or delivery tokens.
 *
 * @param {unknown} value - Raw value to redact.
 * @returns {string | null} Truncated hex digest, or null if value is empty/non-string.
 */
export function redactReference(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  // Already redacted reference
  if (/^sha256:[0-9a-f]{16}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const hash = crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 16);
  return `sha256:${hash}`;
}

function parseIntegerOrNull(val: unknown): number | null {
  if (typeof val === 'number' && Number.isInteger(val)) {
    return val;
  }
  return null;
}

/**
 * Builds a validated, redacted trace record for a state update transition.
 */
export function buildStateUpdateTrace(input: StateUpdateTraceInput): StateUpdateTraceRecord {
  const outcomeValues = Object.values(STATE_UPDATE_OUTCOMES);
  if (!outcomeValues.includes(input.outcome)) {
    throw new TypeError(
      `unknown state update trace outcome "${input.outcome}"; expected one of: ${outcomeValues.join(', ')}`
    );
  }

  const at = input.at ?? new Date().toISOString();
  const bountyId = input.bountyId ? String(input.bountyId) : 'unmatched';
  let eventRef = redactReference(input.eventRef);
  if (!eventRef) {
    // Generate deterministic fallback event reference from transition metadata
    const seed = `${bountyId}:${input.transition}:${input.expectedVersion ?? 'none'}:${at}`;
    eventRef = redactReference(seed)!;
  }

  const actorRef = input.actorRef ? redactReference(input.actorRef) : redactReference(input.actor);

  return {
    event: STATE_UPDATE_TRACE_EVENT,
    outcome: input.outcome,
    at,
    bountyId,
    transition: String(input.transition),
    eventRef,
    deliveryRef: redactReference(input.deliveryRef),
    cursorRef: redactReference(input.cursorRef),
    expectedVersion: parseIntegerOrNull(input.expectedVersion),
    currentVersion: parseIntegerOrNull(input.currentVersion),
    fromStatus: input.fromStatus ? String(input.fromStatus) : null,
    toStatus: input.toStatus ? String(input.toStatus) : null,
    actorRef,
    workerId: input.workerId ? String(input.workerId) : null,
    error: input.error ? String(input.error) : null,
    reason: input.reason ? String(input.reason) : null,
  };
}

export type TraceSink = (record: StateUpdateTraceRecord) => void;

let globalTraceSink: TraceSink | null = null;

/**
 * Configure a global trace sink (primarily used in tests and custom observability aggregators).
 */
export function setGlobalStateUpdateTraceSink(sink: TraceSink | null): void {
  globalTraceSink = sink;
}

export function getGlobalStateUpdateTraceSink(): TraceSink | null {
  return globalTraceSink;
}

export interface StateUpdateTraceEmitter {
  pending: (input: Omit<StateUpdateTraceInput, 'outcome'>) => StateUpdateTraceRecord;
  committed: (input: Omit<StateUpdateTraceInput, 'outcome'>) => StateUpdateTraceRecord;
  failed: (input: Omit<StateUpdateTraceInput, 'outcome'>) => StateUpdateTraceRecord;
}

/**
 * Creates a trace emitter instance that sends records to `sink` or standard structured loggers.
 */
export function createStateUpdateTrace(customSink?: TraceSink): StateUpdateTraceEmitter {
  const emit = (outcome: StateUpdateOutcome) => (entry: Omit<StateUpdateTraceInput, 'outcome'>) => {
    const record = buildStateUpdateTrace({ ...entry, outcome });
    if (customSink) {
      customSink(record);
    } else if (globalTraceSink) {
      globalTraceSink(record);
    } else {
      // Structured logging and log-aggregator line
      logger.info(record, `[StateUpdate][trace] ${JSON.stringify(record)}`);
    }
    return record;
  };

  return {
    pending: emit(STATE_UPDATE_OUTCOMES.pending),
    committed: emit(STATE_UPDATE_OUTCOMES.committed),
    failed: emit(STATE_UPDATE_OUTCOMES.failed),
  };
}

/**
 * Default trace emitter used by bounty store and worker methods.
 */
export const defaultStateUpdateTrace = createStateUpdateTrace();

/**
 * Parameters for tracing GitHub webhook processing outcomes (#1943).
 */
export interface WebhookTraceInput {
  outcome: StateUpdateOutcome;
  deliveryRef?: string | null;
  eventRef?: string | null;
  cursorRef?: string | null;
  bountyId?: string | null;
  transition?: string;
  expectedVersion?: number | null;
  currentVersion?: number | null;
  error?: string | null;
  reason?: string | null;
  workerId?: string | null;
  actorRef?: string | null;
}

/**
 * Emits a structured trace record for GitHub webhook lifecycle outcomes (#1943),
 * including invalid HMAC signatures (outcome: 'failed') and out-of-order close events
 * (outcome: 'pending'). Redacts delivery and event references with SHA-256 digests.
 */
export function traceWebhookOutcome(input: WebhookTraceInput): StateUpdateTraceRecord {
  const transition =
    input.transition ?? (input.outcome === 'failed' ? 'webhook_signature_verify' : 'pr_merged');
  const record = buildStateUpdateTrace({
    outcome: input.outcome,
    bountyId: input.bountyId ?? 'unmatched',
    transition,
    deliveryRef: input.deliveryRef,
    eventRef: input.eventRef ?? (input.deliveryRef ? `delivery:${input.deliveryRef}` : undefined),
    cursorRef: input.cursorRef,
    expectedVersion: input.expectedVersion,
    currentVersion: input.currentVersion,
    error: input.error,
    reason: input.reason,
    workerId: input.workerId,
    actorRef: input.actorRef,
  });

  if (globalTraceSink) {
    globalTraceSink(record);
  } else {
    logger.info(record, `[StateUpdate][trace] ${JSON.stringify(record)}`);
  }
  return record;
}

