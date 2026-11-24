import { logger } from '../logger';

/**
 * Event identifier for JSON bounty store write tracing (SBB-2026-454).
 */
export const STORE_WRITE_TRACE_EVENT = 'bounty_store_write';

/**
 * Valid outcomes for a JSON store write attempt.
 *
 * - `pending`: The write has been initiated but not yet durably committed.
 * - `committed`: The payload was serialized, atomically renamed into place, and any
 *   interrupted predecessor was resolved.
 * - `failed`: The write was rejected (validation) or aborted (I/O error); the
 *   previous on-disk state remains authoritative.
 */
export const STORE_WRITE_OUTCOMES = {
  pending: 'pending',
  committed: 'committed',
  failed: 'failed',
} as const;

export type StoreWriteOutcome = (typeof STORE_WRITE_OUTCOMES)[keyof typeof STORE_WRITE_OUTCOMES];

/** Which JSON store file a write targets. */
export type StoreWriteKind = 'bounties' | 'audit';

/**
 * Input parameters for building a structured store write trace record.
 */
export interface StoreWriteTraceInput {
  outcome: StoreWriteOutcome;
  store: StoreWriteKind;
  /** Number of records in the payload being written. */
  recordCount?: number | null;
  /** Serialized payload size in bytes, when known. */
  bytes?: number | null;
  /** Wall-clock duration of the write attempt in milliseconds. */
  durationMs?: number | null;
  /** True when this record describes a write resumed after interruption. */
  resumed?: boolean;
  error?: string | null;
  reason?: string | null;
  at?: string;
}

/**
 * Formatted store write trace record emitted to logs/sinks.
 */
export interface StoreWriteTraceRecord {
  event: typeof STORE_WRITE_TRACE_EVENT;
  outcome: StoreWriteOutcome;
  at: string;
  store: StoreWriteKind;
  recordCount: number | null;
  bytes: number | null;
  durationMs: number | null;
  resumed: boolean;
  error: string | null;
  reason: string | null;
}

function parseNonNegativeIntOrNull(val: unknown): number | null {
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0) {
    return val;
  }
  return null;
}

/**
 * Builds a validated trace record for a JSON store write outcome.
 */
export function buildStoreWriteTrace(input: StoreWriteTraceInput): StoreWriteTraceRecord {
  const outcomeValues = Object.values(STORE_WRITE_OUTCOMES);
  if (!outcomeValues.includes(input.outcome)) {
    throw new TypeError(
      `unknown store write trace outcome "${input.outcome}"; expected one of: ${outcomeValues.join(', ')}`
    );
  }
  if (input.store !== 'bounties' && input.store !== 'audit') {
    throw new TypeError(`unknown store write target "${input.store}"; expected 'bounties' or 'audit'`);
  }

  return {
    event: STORE_WRITE_TRACE_EVENT,
    outcome: input.outcome,
    at: input.at ?? new Date().toISOString(),
    store: input.store,
    recordCount: parseNonNegativeIntOrNull(input.recordCount),
    bytes: parseNonNegativeIntOrNull(input.bytes),
    durationMs: parseNonNegativeIntOrNull(input.durationMs),
    resumed: input.resumed === true,
    error: input.error ? String(input.error) : null,
    reason: input.reason ? String(input.reason) : null,
  };
}

export type StoreWriteTraceSink = (record: StoreWriteTraceRecord) => void;

let globalStoreWriteTraceSink: StoreWriteTraceSink | null = null;

/**
 * Configure a global store write trace sink (primarily used in tests and custom
 * observability aggregators).
 */
export function setGlobalStoreWriteTraceSink(sink: StoreWriteTraceSink | null): void {
  globalStoreWriteTraceSink = sink;
}

export function getGlobalStoreWriteTraceSink(): StoreWriteTraceSink | null {
  return globalStoreWriteTraceSink;
}

export interface StoreWriteTraceEmitter {
  pending: (input: Omit<StoreWriteTraceInput, 'outcome'>) => StoreWriteTraceRecord;
  committed: (input: Omit<StoreWriteTraceInput, 'outcome'>) => StoreWriteTraceRecord;
  failed: (input: Omit<StoreWriteTraceInput, 'outcome'>) => StoreWriteTraceRecord;
}

/**
 * Creates a trace emitter instance that sends records to `sink` or standard
 * structured loggers.
 */
export function createStoreWriteTrace(customSink?: StoreWriteTraceSink): StoreWriteTraceEmitter {
  const emit =
    (outcome: StoreWriteOutcome) => (entry: Omit<StoreWriteTraceInput, 'outcome'>) => {
      const record = buildStoreWriteTrace({ ...entry, outcome });
      if (customSink) {
        customSink(record);
      } else if (globalStoreWriteTraceSink) {
        globalStoreWriteTraceSink(record);
      } else {
        logger.info(record, `[StoreWrite][trace] ${JSON.stringify(record)}`);
      }
      return record;
    };

  return {
    pending: emit(STORE_WRITE_OUTCOMES.pending),
    committed: emit(STORE_WRITE_OUTCOMES.committed),
    failed: emit(STORE_WRITE_OUTCOMES.failed),
  };
}

/**
 * Default store write trace emitter used by the bounty store write path.
 */
export const defaultStoreWriteTrace = createStoreWriteTrace();
