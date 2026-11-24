// Soroban Contract Event Indexer Worker
// Polls contract events and normalizes them for backend use

import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isMainThread, parentPort } from "worker_threads";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { loadIndexerConfig } from "./indexerConfig.js";
import { createConsoleCursorTrace } from "./cursorTrace.js";

// CONFIGURATION
const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID || ""; // Set in env
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || "https://rpc-futurenet.stellar.org";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_FILE = path.join(__dirname, "indexed-events.json");
const CURSOR_FILE =
  process.env.SOROBAN_INDEXER_CURSOR_FILE || path.join(__dirname, "indexed-events.cursor.json");
const PAGE_LIMIT = 100;

// Operational settings are env-driven (see indexerConfig.js for the variables
// and their defaults, which match the values previously hardcoded here).
const {
  pollIntervalMs: POLL_INTERVAL_MS,
  maxRetries: MAX_RETRIES,
  initialBackoffMs: INITIAL_BACKOFF_MS,
} = loadIndexerConfig();

// Retry wrapper with exponential backoff
async function retryWithBackoff(fn, maxRetries = MAX_RETRIES) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.log(`[Indexer] Retry attempt ${attempt + 1}/${maxRetries} after ${backoffMs}ms. Error: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      } else {
        console.error(`[Indexer] All ${maxRetries} retries exhausted. Last error:`, err.message);
      }
    }
  }
  throw lastError;
}

const EVENT_TYPES = {
  Create: "create",
  CrtEvent: "created",
  Reserv: "reserve",
  Submit: "submit",
  Releas: "release",
  Refund: "refund",
  Dispt: "disputed",
};

function decodeScVal(value) {
  if (typeof value !== "string") return value;
  return scValToNative(xdr.ScVal.fromXDR(value, "base64"));
}

function eventData(value) {
  const decoded = decodeScVal(value);
  if (decoded instanceof Map) {
    return Object.fromEntries(decoded.entries());
  }
  return decoded && typeof decoded === "object" ? decoded : {};
}

function jsonSafe(value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function addressString(value) {
  return typeof value === "string" || value == null ? value : value.toString();
}

// Decode Soroban's XDR topics and value before passing events to consumers.
//
// Topic layout for the release transition (documented in the contract):
//   topic[0] = "Bounty" (symbol)
//   topic[1] = "Releas" (symbol)
//   value    = BountyReleased { bounty_id, contributor, maintainer, amount }
// The payload is sufficient on its own, so the worker does not need a follow-up
// contract read to react to this transition.
export function normalizeEvent(event) {
  const topics = Array.isArray(event.topic)
    ? event.topic.map(decodeScVal)
    : Array.isArray(event.topics)
      ? event.topics.map(decodeScVal)
      : [];
  const data = eventData(event.value ?? event.data ?? event);
  const bountyId = data.bounty_id ?? data.bountyId ?? event.bounty_id;
  const maintainer = addressString(data.maintainer ?? event.maintainer);
  const contributor = addressString(data.contributor ?? event.contributor);
  const arbiter = addressString(data.arbiter ?? event.arbiter);
  const type = EVENT_TYPES[topics[1]] ?? event.type;

  const normalized = {
    id: event.id ?? event.paging_token ?? event.pagingToken,
    type,
    bountyId: jsonSafe(bountyId),
    actor: maintainer ?? contributor ?? addressString(event.actor),
    maintainer,
    contributor,
    arbiter,
    amount: jsonSafe(data.amount ?? event.amount),
    timestamp: event.ledger_closed_at ?? event.ledgerClosedAt ?? event.timestamp,
    ledger: event.ledger !== undefined ? Number(event.ledger) : undefined,
    raw: event,
  };

  // For the release transition, surface the contributor and amount explicitly so
  // consumers can react without a follow-up contract read. The payload already
  // carries these fields (BountyReleased), so this is just a convenience view.
  if (type === " release".trim()) {
    normalized.released = true;
  }

 // `created` is the structured create_bounty event (BountyCreatedEvent).
  // The payload carries everything the worker needs, so no follow-up
  // contract read is required.
  if (type === "created") {
    normalized.token = addressString(data.token);
    normalized.repo = data.repo;
    normalized.issueNumber = jsonSafe(data.issue_number);
    normalized.title = data.title;
    normalized.deadline = jsonSafe(data.deadline);
    normalized.protocolFeeBps = jsonSafe(data.protocol_fee_bps);
    normalized.disputeWindowOverride = jsonSafe(data.dispute_window_override ?? null);
    normalized.createdAt = jsonSafe(data.created_at);
  }

  return normalized;
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readEvents(indexFile) {
  if (!fs.existsSync(indexFile)) return [];
  const parsed = JSON.parse(fs.readFileSync(indexFile, "utf-8"));
  return Array.isArray(parsed) ? parsed : [];
}

function loadCursor(cursorFile, events) {
  if (fs.existsSync(cursorFile)) {
    try {
      const cursor = JSON.parse(fs.readFileSync(cursorFile, "utf-8")).cursor;
      if (typeof cursor === "string" && cursor) return cursor;
    } catch (err) {
      console.warn(`[Indexer] Ignoring unreadable cursor checkpoint: ${err.message}`);
    }
  }
  // Backward compatibility: older installs only have the events file.
  return events.length ? events[events.length - 1].id ?? null : null;
}

// Poll one page of Soroban contract events.
//
// The cursor is committed only after the page's events are on disk, so a
// crash or RPC failure replays the page instead of skipping it. Replayed event
// IDs are deduplicated, so the events file gains each effect at most once.
//
// Every newly indexed event is traced twice (#1933): `pending` before the
// store is touched and `committed` only after the events file and cursor
// checkpoint are durable. A restart after a crash therefore leaves the last
// trace of the interrupted events as `pending`, which is precisely what the
// next poll replays. `options.trace` lets tests capture records instead of
// writing them to the console.
async function pollEvents(options = {}) {
  const indexFile = options.indexFile ?? INDEX_FILE;
  const cursorFile = options.cursorFile ?? CURSOR_FILE;
  const rpcUrl = options.rpcUrl ?? SOROBAN_RPC_URL;
  const contractId = options.contractId ?? CONTRACT_ID;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const trace = options.trace ?? createConsoleCursorTrace();
  const events = readEvents(indexFile);
  const cursor = loadCursor(cursorFile, events);
  const startLedger = options.startLedger ?? process.env.SOROBAN_START_LEDGER;

  if (!cursor && startLedger === undefined) {
    console.error("[Indexer] No cursor checkpoint or SOROBAN_START_LEDGER; skipping poll.");
    return;
  }

  const params = {
    filters: [{ type: "contract", contractIds: [contractId] }],
  };
  if (cursor) {
    params.pagination = { cursor, limit: PAGE_LIMIT };
  } else {
    params.startLedger = Number(startLedger);
    if (!Number.isFinite(params.startLedger)) {
      console.error("[Indexer] SOROBAN_START_LEDGER is not a number; skipping poll.");
      return;
    }
  }

  try {
    const res = await retryWithBackoff(
      () =>
        axios.post(rpcUrl, {
          jsonrpc: "2.0",
          id: "indexer",
          method: "getEvents",
          params,
        }),
      maxRetries,
    );
    const result = res?.data?.result;
    if (!result) {
      throw new Error(res?.data?.error?.message ?? "Malformed getEvents response");
    }

    const page = Array.isArray(result.events) ? result.events : [];
    const knownIds = new Set(events.map((event) => event.id).filter(Boolean));
    const newEvents = page.map(normalizeEvent).filter((event) => {
      if (!event.id) return true;
      if (knownIds.has(event.id)) return false;
      knownIds.add(event.id);
      return true;
    });
    const nextEvents = events.concat(newEvents);
    const lastPageEvent = page[page.length - 1];
    const nextCursor =
      (typeof result.cursor === "string" && result.cursor) ||
      lastPageEvent?.cursor ||
      lastPageEvent?.id ||
      cursor;
    const cursorAdvanced = Boolean(nextCursor) && nextCursor !== cursor;

    // `pending`: the page is processed but nothing is durable yet. Emitted
    // before any write so a crash below leaves a trace that explains the
    // replay of these events on restart.
    for (const event of newEvents) {
      trace.pending({
        event,
        cursorFrom: cursor,
        cursorTo: nextCursor,
        cursorAdvanced,
      });
    }

    if (newEvents.length || nextCursor !== cursor) {
      writeJsonAtomic(indexFile, nextEvents);
      if (nextCursor && nextCursor !== cursor) {
        writeJsonAtomic(cursorFile, { cursor: nextCursor });
      }
    }

    // `committed`: the events file and (when it advanced) the cursor
    // checkpoint are durable, so these effects survive a restart.
    for (const event of newEvents) {
      trace.committed({
        event,
        cursorFrom: cursor,
        cursorTo: nextCursor,
        cursorAdvanced,
      });
    }

    if (parentPort) {
      parentPort.postMessage({ type: "indexedEvents", events: newEvents, cursor: nextCursor });
    }

    console.log(
      `[Indexer] Indexed ${newEvents.length} new events; ` +
        `cursor=${nextCursor ? "advanced" : "none"}; committed=${newEvents.length}.`,
    );
  } catch (err) {
    console.error("[Indexer] Polling failed after all retries:", err.message);
  }
}

function startWorker() {
  console.log("[Indexer] Starting Soroban contract event indexer...");
  // Deliberately omits SOROBAN_RPC_URL: some RPC providers embed an API key in it.
  console.log(
    `[Indexer] Effective config: pollIntervalMs=${POLL_INTERVAL_MS} ` +
      `maxRetries=${MAX_RETRIES} initialBackoffMs=${INITIAL_BACKOFF_MS}`,
  );
  setInterval(pollEvents, POLL_INTERVAL_MS);
}

if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startWorker();
}

export { pollEvents, startWorker };
