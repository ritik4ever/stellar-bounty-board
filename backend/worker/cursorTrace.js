// Cursor outcome tracing for the Soroban indexer (#1933).
//
// Operators must be able to tell, after a restart, whether an indexed event was
// only processed (fetched and normalized while the cursor is still pending) or
// committed (the events file and the cursor checkpoint are both durable).
//
// The worker therefore emits one trace record per newly indexed event before it
// touches the store and one after the store and cursor writes succeed. If the
// process dies in between, the last record an operator sees for that event is
// `pending`, which is exactly the state that will be replayed on restart.
//
// Records are redacted on purpose: raw paging tokens, event IDs and payloads
// never leave the process. Only a truncated SHA-256 reference is recorded —
// enough to correlate a pending record with its committed counterpart (and
// with the RPC cursor) without copying chain data into the logs.

import crypto from "crypto";

/** The two cursor outcomes an operator can observe for an indexed event. */
export const CURSOR_TRACE_OUTCOMES = Object.freeze({
  /** Event was processed; the cursor has not been persisted yet. */
  pending: "pending",
  /** Event, events file and cursor checkpoint are durable. */
  committed: "committed",
});

/** Stable event name so log aggregators can filter these records. */
export const CURSOR_TRACE_EVENT = "soroban_indexer_cursor";

const REFERENCE_PREFIX = "sha256:";
const REFERENCE_LENGTH = 16;

/**
 * Redact a raw event ID or paging token into a stable, non-reversible reference.
 *
 * The same input always yields the same reference, so a `pending` record and
 * its `committed` record are correlatable, while the token itself is not
 * recoverable from the logs.
 *
 * @param {unknown} value
 * @returns {string | null} Reference, or `null` when the input is not a
 *   non-empty string.
 */
export function redactCursorReference(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const digest = crypto.createHash("sha256").update(value, "utf8").digest("hex");
  return `${REFERENCE_PREFIX}${digest.slice(0, REFERENCE_LENGTH)}`;
}

function integerOrNull(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Build one redacted trace record.
 *
 * Only public chain metadata (ledger sequence, normalized event type, bounty ID)
 * and hashed references are included. The raw payload (`event.raw`) is never
 * copied, so an oversized or untrusted payload cannot flood the logs.
 *
 * @param {{
 *   outcome: string,
 *   event?: { id?: unknown, type?: unknown, bountyId?: unknown, ledger?: unknown },
 *   cursorFrom?: unknown,
 *   cursorTo?: unknown,
 *   cursorAdvanced?: boolean,
 *   at?: string,
 * }} input
 * @returns {{
 *   event: string,
 *   outcome: string,
 *   at: string,
 *   eventRef: string | null,
 *   ledger: number | null,
 *   type: string | null,
 *   bountyId: string | null,
 *   cursorFrom: string | null,
 *   cursorTo: string | null,
 *   cursorAdvanced: boolean,
 * }}
 */
export function buildCursorTrace(input) {
  if (!Object.values(CURSOR_TRACE_OUTCOMES).includes(input?.outcome)) {
    throw new TypeError(`unknown cursor trace outcome: ${String(input?.outcome)}`);
  }
  const event = input.event ?? {};
  const bountyId =
    event.bountyId === undefined || event.bountyId === null ? null : String(event.bountyId);
  return {
    event: CURSOR_TRACE_EVENT,
    outcome: input.outcome,
    at: input.at ?? new Date().toISOString(),
    eventRef: redactCursorReference(event.id),
    ledger: integerOrNull(event.ledger),
    type: typeof event.type === "string" ? event.type : null,
    bountyId,
    cursorFrom: redactCursorReference(input.cursorFrom),
    cursorTo: redactCursorReference(input.cursorTo),
    cursorAdvanced: Boolean(input.cursorAdvanced),
  };
}

/**
 * Create a trace emitter that hands every record to `sink`.
 *
 * @param {(record: ReturnType<typeof buildCursorTrace>) => void} sink
 */
export function createCursorTrace(sink) {
  if (typeof sink !== "function") {
    throw new TypeError("cursor trace sink must be a function");
  }
  const emit = (outcome) => (entry) => {
    const record = buildCursorTrace({ ...entry, outcome });
    sink(record);
    return record;
  };
  return {
    pending: emit(CURSOR_TRACE_OUTCOMES.pending),
    committed: emit(CURSOR_TRACE_OUTCOMES.committed),
  };
}

/**
 * Default emitter: one structured, single-line record per outcome, so the
 * worker keeps its existing logging contract (plain console output) while
 * remaining parseable by a log aggregator.
 *
 * @param {Pick<Console, "log">} [logger]
 */
export function createConsoleCursorTrace(logger = console) {
  return createCursorTrace((record) => {
    logger.log(`[Indexer][cursor-trace] ${JSON.stringify(record)}`);
  });
}
