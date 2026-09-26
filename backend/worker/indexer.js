// Soroban Contract Event Indexer Worker
// Polls contract events and normalizes them for backend use

import axios from "axios";
import fs from "fs";
import path from "path";
import { loadIndexerConfig } from "./indexerConfig.js";
let parentPort;
try {
  // worker_threads parentPort is available when running as a Worker
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  parentPort = require("worker_threads").parentPort;
} catch (e) {
  parentPort = undefined;
}

// CONFIGURATION
const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID || ""; // Set in env
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || "https://rpc-futurenet.stellar.org";
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

// Event normalization mapping
function normalizeEvent(event) {
  // Example: map Soroban event to backend-friendly record
  // Adjust mapping as contract evolves
  return {
    id: event.id,
    type: event.type, // create, reserve, release, refund
    bountyId: event.bounty_id,
    actor: event.actor,
    timestamp: event.timestamp,
    raw: event,
  };
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
      `maxRetries=${MAX_RETRIES} initialBackoffMs=${INITIAL_BACKOFF_MS}`,
  );
  setInterval(pollEvents, POLL_INTERVAL_MS);
}

if (require.main === module) {
  startWorker();
}

export { pollEvents, startWorker };
