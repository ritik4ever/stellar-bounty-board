import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Correlation IDs (#1457).
 *
 * The API and the Soroban indexer worker are separate processes, so tracing one
 * bounty action from an inbound request to the worker that indexes the resulting
 * contract event used to mean manually lining up timestamps across two log
 * streams. Every request now carries a single correlation id that is:
 *
 *   1. minted (or accepted) at the API boundary by the request-context middleware,
 *   2. placed in an `AsyncLocalStorage` context so any async work started while
 *      handling the request inherits it, and
 *   3. handed to the indexer worker thread through `workerData` and echoed back
 *      on every log line and `postMessage` it emits.
 *
 * Grep one id and you get the whole story in both log streams.
 */

/**
 * Accepted correlation-id shape. Matches the request-id format: 1–128 chars of
 * `[a-zA-Z0-9-]`, so an inbound `X-Request-ID` can be reused verbatim without
 * letting newline/control characters reach the logs.
 */
export const CORRELATION_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/;

export interface CorrelationContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Mint a fresh correlation id (UUID v4). */
export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Return `raw` as a usable correlation id, or `undefined` when it is absent or
 * malformed. Never throws — callers fall back to {@link newCorrelationId}.
 */
export function normalizeCorrelationId(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return CORRELATION_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

/**
 * Run `fn` with `correlationId` as the active correlation id. Any async work
 * spawned inside `fn` (promises, timers, queued jobs) inherits the context.
 */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

/** The active correlation id, or `undefined` outside a correlated context. */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Log fields for the active (or explicitly given) correlation id. Spread into a
 * structured log call so the id shows up next to the message.
 */
export function correlationFields(correlationId: string | undefined = getCorrelationId()): {
  correlationId?: string;
} {
  return correlationId ? { correlationId } : {};
}
