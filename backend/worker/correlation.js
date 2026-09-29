// Correlation ids for the Soroban indexer worker (#1457).
//
// The API generates one correlation id per request and passes a stable session
// id into the worker thread through `workerData`. Every log line the worker
// emits carries that id, and the `indexedEvents` message it posts back to the
// backend echoes it, so a single upstream action can be followed from the API
// request into the worker and back without matching timestamps by hand.
//
// Kept dependency-free and side-effect-free so it can be unit tested on its own.

import { randomUUID } from "node:crypto";

/** Same shape as the backend correlation id: 1–128 chars of `[a-zA-Z0-9-]`. */
export const CORRELATION_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/;

/**
 * Return `raw` as a usable correlation id, or `undefined` when it is absent or
 * malformed. Never throws.
 *
 * @param {unknown} raw
 * @returns {string | undefined}
 */
export function normalizeCorrelationId(raw) {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return CORRELATION_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

/**
 * Resolve the worker's session correlation id from `workerData`, falling back to
 * a freshly generated id when the parent did not supply a valid one. Never
 * throws.
 *
 * @param {{ correlationId?: unknown } | undefined} workerData
 * @param {() => string} [generate]
 * @returns {string}
 */
export function resolveWorkerCorrelationId(workerData, generate = () => randomUUID()) {
  return normalizeCorrelationId(workerData && workerData.correlationId) || generate();
}

/**
 * Build a logger that prefixes every line with `[Indexer][cid=<id>]` so worker
 * output is greppable by correlation id.
 *
 * @param {string} correlationId
 * @param {{ log?: Function, warn?: Function, error?: Function }} [sink]
 */
export function createCorrelationLogger(correlationId, sink = console) {
  const prefix = `[Indexer][cid=${correlationId}]`;

  return {
    correlationId,
    info: (message, ...rest) => sink.log(`${prefix} ${message}`, ...rest),
    warn: (message, ...rest) => sink.warn(`${prefix} ${message}`, ...rest),
    error: (message, ...rest) => sink.error(`${prefix} ${message}`, ...rest),
  };
}
