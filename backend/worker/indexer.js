// Soroban Contract Event Indexer Worker
// Polls contract events and normalizes them for backend use

import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isMainThread, parentPort } from "worker_threads";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { loadIndexerConfig } from "./indexerConfig.js";

// CONFIGURATION
const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID || ""; // Set in env
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || "https://rpc-futurenet.stellar.org";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_FILE = path.join(__dirname, "indexed-events.json");

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
  RelEvent: "release",
  Refund: "refund",
  Dispt: "disputed",
  Queried: "queried",
};

function decodeScVal(value) {
  if (typeof value !== "string") return value;
  try {
    return scValToNative(xdr.ScVal.fromXDR(value, "base64"));
  } catch {
    // A value that is not valid XDR stays as-is: one malformed event should
    // not stop the whole poll from being indexed.
    return value;
  }
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

// `jsonSafe` only handles top-level fields; the queried state is a whole struct
// whose u64/i128 fields decode to BigInt, which JSON.stringify cannot serialise.
function jsonSafeDeep(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafeDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSafeDeep(entry)]));
  }
  return value;
}

// A contract enum unit variant is encoded as a one-element vector, so
// `scValToNative` yields ["Expired"] rather than "Expired".
function normalizeStatus(status) {
  if (Array.isArray(status) && status.length === 1) return status[0];
  return status;
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

// Save events to file (or replace with DB logic)
function saveEvents(events) {
  if (parentPort) {
    // In worker mode, send events to the main thread instead of persisting locally
    parentPort.postMessage({ type: "indexedEvents", events });
  } else {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(events, null, 2));
  }
}

// Load last indexed event (for polling)
function loadLastEventId() {
  if (!fs.existsSync(INDEX_FILE)) return null;
  const events = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
  return events.length ? events[events.length - 1].id : null;
}

// Poll Soroban contract events
async function pollEvents() {
  let lastEventId = loadLastEventId();
  try {
    const res = await retryWithBackoff(() =>
      axios.get(`${SOROBAN_RPC_URL}/events`, {
        params: {
          contract_id: CONTRACT_ID,
          from_id: lastEventId,
        },
      })
    );
    const events = res.data.events || [];
    if (events.length) {
      const normalized = events.map(normalizeEvent);
      let allEvents = [];
      if (!parentPort) {
        if (fs.existsSync(INDEX_FILE)) {
          allEvents = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
        }
        allEvents.push(...normalized);
      } else {
        allEvents = normalized;
      }
      saveEvents(allEvents);
      console.log(`[Indexer] Indexed ${events.length} new events.`);
    } else {
      console.log("[Indexer] No new events.");
    }
  } catch (err) {
    console.error("[Indexer] Polling failed after all retries:", err.message);
  }
}

function startWorker() {
  console.log("[Indexer] Starting Soroban contract event indexer...");
  // Deliberately omits SOROBAN_RPC_URL: some RPC providers embed an API key in it.
  console.log(
    `[Indexer] Effective config: pollIntervalMs=${POLL_INTERVAL_MS} ` +
      `maxRetries=${MAX_RETRIES} initialBackoffMs=${INITIAL_BACKKOFF_MS}`,
  );
  setInterval(pollEvents, POLL_INTERVAL_MS);
}

if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startWorker();
}

export { pollEvents, startWorker };
