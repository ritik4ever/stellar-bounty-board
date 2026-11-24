// Operator-triggered Soroban event backfill (#1937).
//
// Backfill re-reads a bounded ledger range and merges the events into the same
// store the live worker writes. The input is untrusted: it is authenticated
// with an operator token and validated before any RPC call, and every RPC page
// is validated before any event is persisted.
//
// Safety properties:
//   * Fail closed: without SOROBAN_BACKFILL_TOKEN every request is rejected.
//   * The token is compared in constant time and never appears in errors/logs.
//   * Requests cannot override the RPC URL, contract ID, or store paths.
//   * A page is merged atomically and only then is the cursor advanced, so a
//     failed or partial page is retried as a whole; re-reading a ledger is a
//     no-op because events are deduplicated by chain position.
//   * Events already written by live polling are preserved and never rewritten.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";
import { normalizeEvent } from "./indexer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Inclusive upper bound on a single backfill request, in ledgers. */
export const MAX_LEDGER_RANGE = 5_000;
/** Upper bound on RPC pages fetched for one request. */
export const MAX_PAGES = 50;
/** Maximum accepted length of a caller-supplied paging token. */
const MAX_CURSOR_LENGTH = 256;
const CURSOR_PATTERN = /^[A-Za-z0-9+/=_-]+$/;
const ALLOWED_REQUEST_KEYS = new Set(["startLedger", "endLedger", "cursor"]);

export class BackfillError extends Error {
  /**
   * @param {string} message Safe to log; never contains the token or RPC URL.
   * @param {'unauthorized' | 'invalid_request' | 'malformed_rpc_response' | 'missing_rpc_page' | 'malformed_event' | 'store_error'} code
   */
  constructor(message, code) {
    super(message);
    this.name = "BackfillError";
    this.code = code;
  }
}

function toBuffer(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}

/**
 * Rejects every backfill unless the operator configured a token and supplied
 * a matching one. The comparison hashes both sides so it is constant-time and
 * independent of the attacker-controlled token length.
 */
export function authenticateBackfill(token, env = process.env) {
  const expected = env.SOROBAN_BACKFILL_TOKEN;
  if (typeof expected !== "string" || expected.length === 0) {
    throw new BackfillError(
      "backfill is disabled: SOROBAN_BACKFILL_TOKEN is not configured",
      "unauthorized",
    );
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new BackfillError("missing backfill operator token", "unauthorized");
  }
  if (!crypto.timingSafeEqual(toBuffer(token), toBuffer(expected))) {
    throw new BackfillError("invalid backfill operator token", "unauthorized");
  }
}

function requireInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new BackfillError(`${name} must be a positive integer`, "invalid_request");
  }
}

/**
 * Validates the operator request. Unknown keys are rejected rather than
 * ignored so a caller cannot smuggle RPC or storage overrides into the job.
 */
export function validateBackfillRequest(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new BackfillError("backfill request must be a JSON object", "invalid_request");
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED_REQUEST_KEYS.has(key)) {
      throw new BackfillError(`unsupported backfill field: ${key}`, "invalid_request");
    }
  }
  requireInteger(input.startLedger, "startLedger");
  requireInteger(input.endLedger, "endLedger");
  if (input.startLedger > input.endLedger) {
    throw new BackfillError("startLedger must not exceed endLedger", "invalid_request");
  }
  if (input.endLedger - input.startLedger + 1 > MAX_LEDGER_RANGE) {
    throw new BackfillError(
      `ledger range must not exceed ${MAX_LEDGER_RANGE} ledgers`,
      "invalid_request",
    );
  }
  let cursor = null;
  if (input.cursor !== undefined) {
    if (
      typeof input.cursor !== "string" ||
      input.cursor.length === 0 ||
      input.cursor.length > MAX_CURSOR_LENGTH ||
      !CURSOR_PATTERN.test(input.cursor)
    ) {
      throw new BackfillError("cursor must be a short paging token", "invalid_request");
    }
    cursor = input.cursor;
  }
  return { startLedger: input.startLedger, endLedger: input.endLedger, cursor };
}

function contractIdOf(event) {
  return event.contract_id ?? event.contractId;
}

function ledgerOf(event) {
  const raw = event.raw ?? event;
  return Number(raw.ledger ?? raw.ledgerNumber);
}

function eventIndexesOf(event) {
  const raw = event.raw ?? event;
  const index = raw.event_index ?? raw.eventIndex;
  return index == null ? null : Number(index);
}

/** Chain-position key used to deduplicate backfill against live polling. */
export function backfillEventKey(event) {
  if (typeof event.id === "string" && event.id.length > 0) return `id:${event.id}`;
  const ledger = ledgerOf(event);
  const index = eventIndexesOf(event);
  if (Number.isInteger(ledger) && Number.isInteger(index)) return `pos:${ledger}:${index}`;
  return null;
}

function validateRpcEvent(event, contractId) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new BackfillError("RPC event is not an object", "malformed_event");
  }
  const eventContract = contractIdOf(event);
  if (typeof eventContract !== "string" || eventContract !== contractId) {
    throw new BackfillError("RPC event is for a different contract", "malformed_event");
  }
  const ledger = Number(event.ledger);
  if (!Number.isInteger(ledger) || ledger <= 0) {
    throw new BackfillError("RPC event has an invalid ledger", "malformed_event");
  }
  if (event.event_index !== undefined) {
    const index = Number(event.event_index);
    if (!Number.isInteger(index) || index < 0) {
      throw new BackfillError("RPC event has an invalid event_index", "malformed_event");
    }
  }
  const id = event.id ?? event.paging_token ?? event.pagingToken;
  if (typeof id !== "string" || id.length === 0 || id.length > 128) {
    throw new BackfillError("RPC event has no usable identifier", "malformed_event");
  }
  if (!Array.isArray(event.topic) || event.topic.length < 2) {
    throw new BackfillError("RPC event has an invalid topic list", "malformed_event");
  }
  for (const topic of event.topic) {
    if (typeof topic !== "string" || topic.length === 0) {
      throw new BackfillError("RPC event topic is not XDR", "malformed_event");
    }
  }
  const value = event.value ?? event.data;
  if (value === undefined || value === null) {
    throw new BackfillError("RPC event has no value", "malformed_event");
  }
}

/**
 * Validates one getEvents response. A response without an `events` array is a
 * missing page, not an empty one: silently treating it as empty would skip
 * every event the page was meant to contain.
 */
export function validateRpcPage(body, contractId) {
  const result = body !== null && typeof body === "object" ? body.result : null;
  if (result === null || typeof result !== "object") {
    throw new BackfillError("RPC response is not a getEvents result", "malformed_rpc_response");
  }
  const latestLedger = Number(result.latestLedger);
  if (!Number.isInteger(latestLedger) || latestLedger < 0) {
    throw new BackfillError(
      "RPC response is missing latestLedger",
      "malformed_rpc_response",
    );
  }
  if (!Array.isArray(result.events)) {
    throw new BackfillError("RPC response is missing the events page", "missing_rpc_page");
  }
  const pagingToken = result.cursor ?? result.paginationToken ?? null;
  if (pagingToken !== null && typeof pagingToken !== "string") {
    throw new BackfillError("RPC response has an invalid paging token", "malformed_rpc_response");
  }
  for (const event of result.events) {
    validateRpcEvent(event, contractId);
  }
  return { events: result.events, latestLedger, pagingToken };
}

function normalizePageEvent(event) {
  let normalized;
  try {
    normalized = normalizeEvent(event);
  } catch {
    // Do not echo the payload: it is untrusted XDR and may be arbitrarily large.
    throw new BackfillError("RPC event could not be decoded", "malformed_event");
  }
  if (!normalized.type || backfillEventKey(normalized) === null) {
    throw new BackfillError("RPC event is not a recognized bounty event", "malformed_event");
  }
  return normalized;
}

function atomicWriteJson(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function identitySet(events) {
  const keys = new Set();
  for (const event of events) {
    const key = backfillEventKey(event);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * File-backed store shared with the live worker's `indexed-events.json`.
 * Merging reads the current file, appends only unseen events, and replaces the
 * file atomically, so live-polled events are preserved.
 */
export function createFileBackfillStore(
  eventFile = path.join(__dirname, "indexed-events.json"),
  cursorFile = `${eventFile}.backfill-cursor.json`,
) {
  function readEvents() {
    if (!fs.existsSync(eventFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(eventFile, "utf-8"));
    if (!Array.isArray(parsed)) {
      throw new BackfillError("event store is not a JSON array", "store_error");
    }
    return parsed;
  }

  return {
    readEvents,
    readCursor() {
      if (!fs.existsSync(cursorFile)) return null;
      const parsed = JSON.parse(fs.readFileSync(cursorFile, "utf-8"));
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        !Number.isInteger(parsed.ledger) ||
        !Number.isInteger(parsed.eventIndex)
      ) {
        throw new BackfillError("backfill cursor is corrupt", "store_error");
      }
      return { ledger: parsed.ledger, eventIndex: parsed.eventIndex };
    },
    saveCursor(cursor) {
      atomicWriteJson(cursorFile, cursor);
    },
    /**
     * Appends events not already present. Existing entries (including live
     * polling output) are never removed or rewritten.
     */
    merge(incoming) {
      const existing = readEvents();
      const seen = identitySet(existing);
      const additions = [];
      let skipped = 0;
      for (const event of incoming) {
        const key = backfillEventKey(event);
        if (key === null || seen.has(key)) {
          skipped += 1;
          continue;
        }
        seen.add(key);
        additions.push(event);
      }
      if (additions.length > 0) {
        atomicWriteJson(eventFile, existing.concat(additions));
      }
      return { added: additions.length, skipped };
    },
  };
}

/**
 * Default page fetcher: Soroban RPC `getEvents`, scoped to the configured
 * contract. The request cannot be redirected by the caller.
 */
export function createRpcPageFetcher(env = process.env) {
  const rpcUrl = env.SOROBAN_RPC_URL || "https://rpc-futurenet.stellar.org";
  const contractId = env.SOROBAN_CONTRACT_ID || "";
  if (!contractId) {
    throw new BackfillError("SOROBAN_CONTRACT_ID is not configured", "invalid_request");
  }
  return async function fetchPage({ startLedger, cursor }) {
    const params = {
      contractIds: [contractId],
      startLedger,
      filters: [],
      limit: 200,
    };
    if (cursor) params.cursor = cursor;
    const res = await axios.post(
      rpcUrl,
      { jsonrpc: "2.0", id: 1, method: "getEvents", params },
      { headers: { "Content-Type": "application/json" }, timeout: 10_000 },
    );
    return res.data;
  };
}

/**
 * Produces a redacted, non-reversible reference for a cursor, event ID, or
 * delivery token so operators can correlate retries and missing pages without
 * exposing raw tokens or endpoint secrets in logs.
 *
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function redactBackfillRef(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const digest = crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
  return `sha256:${digest}`;
}

function recordTrace(trace, { logger, onTrace, traces }) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...trace,
  };
  traces.push(entry);
  if (typeof onTrace === "function") {
    onTrace(entry);
  }
  const line = `[BackfillTrace] ${JSON.stringify(entry)}`;
  if (entry.status === "failed" && typeof logger.error === "function") {
    logger.error(line);
  } else if (typeof logger.log === "function") {
    logger.log(line);
  }
}

/**
 * Runs one authenticated, validated backfill.
 *
 * @param {{
 *   token: string,
 *   request: unknown,
 *   env?: NodeJS.ProcessEnv,
 *   fetchPage?: (args: { startLedger: number, cursor: string | null }) => Promise<unknown>,
 *   store?: ReturnType<typeof createFileBackfillStore>,
 *   logger?: Pick<Console, 'log' | 'error'>,
 *   onTrace?: (trace: Record<string, unknown>) => void,
 * }} options
 */
export async function runEventBackfill(options) {
  const { token, request, env = process.env, logger = console, onTrace } = options;
  authenticateBackfill(token, env);
  const validated = validateBackfillRequest(request);

  const contractId = env.SOROBAN_CONTRACT_ID || "";
  if (!contractId) {
    throw new BackfillError("SOROBAN_CONTRACT_ID is not configured", "invalid_request");
  }
  const fetchPage = options.fetchPage ?? createRpcPageFetcher(env);
  const store = options.store ?? createFileBackfillStore();

  const stored = store.readCursor();
  let startLedger = validated.startLedger;
  const traces = [];
  if (stored && stored.ledger >= startLedger) {
    // Re-read the whole stored ledger: the cursor records the last position
    // merged, and deduplication makes replaying it a no-op.
    startLedger = stored.ledger;
    recordTrace(
      {
        phase: "backfill_page",
        status: "pending",
        reason: "whole_ledger_retry",
        ledgerRange: { start: startLedger, end: validated.endLedger },
        cursorRef: redactBackfillRef(validated.cursor),
        storedCursor: { ledger: stored.ledger, eventIndex: stored.eventIndex },
      },
      { logger, onTrace, traces },
    );
  }
  let cursor = validated.cursor;

  let pages = 0;
  let eventsProcessed = 0;
  let eventsSkipped = 0;
  let lastCursor = stored;

  while (startLedger <= validated.endLedger) {
    if (pages >= MAX_PAGES) {
      throw new BackfillError(`backfill exceeded ${MAX_PAGES} RPC pages`, "invalid_request");
    }
    // RPC errors are collapsed to a safe message: axios errors can include the
    // full endpoint, and providers may embed an API key in that URL.
    let body;
    try {
      body = await fetchPage({ startLedger, cursor });
    } catch {
      recordTrace(
        {
          phase: "backfill_page",
          status: "failed",
          reason: "rpc_request_failed",
          errorCode: "malformed_rpc_response",
          page: pages + 1,
          ledgerRange: { start: startLedger, end: validated.endLedger },
          cursorRef: redactBackfillRef(cursor),
          storedCursor: lastCursor
            ? { ledger: lastCursor.ledger, eventIndex: lastCursor.eventIndex }
            : null,
        },
        { logger, onTrace, traces },
      );
      throw new BackfillError("RPC request failed", "malformed_rpc_response");
    }

    let page;
    let normalized;
    try {
      page = validateRpcPage(body, contractId);
      pages += 1;

      const inRange = page.events.filter((event) => Number(event.ledger) <= validated.endLedger);
      normalized = inRange.map(normalizePageEvent);
    } catch (err) {
      const errorCode = err instanceof BackfillError ? err.code : "malformed_rpc_response";
      recordTrace(
        {
          phase: "backfill_page",
          status: "failed",
          reason: errorCode === "missing_rpc_page" ? "missing_rpc_page" : "page_validation_failed",
          errorCode,
          page: pages + 1,
          ledgerRange: { start: startLedger, end: validated.endLedger },
          cursorRef: redactBackfillRef(cursor),
          storedCursor: lastCursor
            ? { ledger: lastCursor.ledger, eventIndex: lastCursor.eventIndex }
            : null,
        },
        { logger, onTrace, traces },
      );
      throw err;
    }

    const eventRefs = normalized
      .map((event) => redactBackfillRef(backfillEventKey(event)))
      .filter(Boolean);

    recordTrace(
      {
        phase: "backfill_page",
        status: "pending",
        reason: "page_fetched",
        page: pages,
        ledgerRange: { start: startLedger, end: validated.endLedger },
        eventCount: normalized.length,
        eventRefs,
        cursorRef: redactBackfillRef(page.pagingToken ?? cursor),
      },
      { logger, onTrace, traces },
    );

    const merged = store.merge(normalized);
    eventsProcessed += merged.added;
    eventsSkipped += merged.skipped;

    if (normalized.length > 0) {
      const tail = normalized.reduce((best, event) => {
        const ledger = ledgerOf(event);
        const eventIndex = eventIndexesOf(event) ?? 0;
        if (!best || ledger > best.ledger || (ledger === best.ledger && eventIndex > best.eventIndex)) {
          return { ledger, eventIndex };
        }
        return best;
      }, null);
      lastCursor = tail;
      store.saveCursor(lastCursor);
    }

    recordTrace(
      {
        phase: "backfill_page",
        status: "committed",
        reason:
          merged.added === 0 && merged.skipped > 0 ? "whole_ledger_retry_deduped" : "page_committed",
        page: pages,
        ledgerRange: { start: startLedger, end: validated.endLedger },
        eventsAdded: merged.added,
        eventsSkipped: merged.skipped,
        eventRefs,
        cursorRef: redactBackfillRef(page.pagingToken ?? cursor),
        committedCursor: lastCursor
          ? { ledger: lastCursor.ledger, eventIndex: lastCursor.eventIndex }
          : null,
      },
      { logger, onTrace, traces },
    );

    if (page.events.length === 0) break;
    const highestLedger = Math.max(...page.events.map((event) => Number(event.ledger)));
    if (highestLedger > validated.endLedger) break;

    if (page.pagingToken) {
      cursor = page.pagingToken;
      continue;
    }
    // No paging token: advance past the last ledger in this page. The page is
    // always fetched and merged as a unit, so a retry re-reads the whole ledger.
    startLedger = highestLedger + 1;
  }

  logger.log(
    `[Backfill] ledgers ${validated.startLedger}-${validated.endLedger}: ` +
      `${eventsProcessed} added, ${eventsSkipped} already present, ${pages} page(s).`,
  );

  return {
    status: "committed",
    pages,
    eventsProcessed,
    eventsSkipped,
    cursor: lastCursor,
    traces,
  };
}

/**
 * CLI entry point. Input is a JSON string (or `@file`) passed with `--input`.
 * The operator token is read from SOROBAN_BACKFILL_TOKEN, never from argv, so
 * it does not leak into shell history or process listings.
 */
async function main(argv) {
  const inputIndex = argv.indexOf("--input");
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    console.error("usage: SOROBAN_BACKFILL_TOKEN=... node eventBackfill.js --input '<json>|@file>'");
    process.exitCode = 2;
    return;
  }
  const raw = argv[inputIndex + 1];
  let parsed;
  try {
    parsed = JSON.parse(raw.startsWith("@") ? fs.readFileSync(raw.slice(1), "utf-8") : raw);
  } catch {
    console.error("[Backfill] --input must be valid JSON");
    process.exitCode = 2;
    return;
  }
  try {
    const result = await runEventBackfill({ token: process.env.SOROBAN_BACKFILL_TOKEN, request: parsed });
    console.log(`[Backfill] done: ${JSON.stringify(result)}`);
  } catch (err) {
    if (err instanceof BackfillError) {
      console.error(`[Backfill] rejected (${err.code}): ${err.message}`);
    } else {
      console.error(`[Backfill] failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main(process.argv.slice(2));
}
