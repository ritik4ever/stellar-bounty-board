// Soroban Contract Event Indexer Worker
// Polls contract events and normalizes them for backend use

import axios from "axios";
import fs from "fs";
import path from "path";
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
const POLL_INTERVAL_MS = 10000; // 10 seconds
const INDEX_FILE = path.join(__dirname, "indexed-events.json");

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

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

// Capture a failed event into the dead-letter store via the main thread
function deadLetterEvent(rawEvent, errorMessage) {
  if (parentPort) {
    parentPort.postMessage({
      type: "deadLetterEvent",
      rawEvent,
      errorMessage,
    });
  } else {
    // Standalone mode: append to a local dead-letter file
    const dlFile = path.join(__dirname, "dead-letter.json");
    let dlEvents = [];
    if (fs.existsSync(dlFile)) {
      try {
        dlEvents = JSON.parse(fs.readFileSync(dlFile, "utf-8"));
      } catch {
        dlEvents = [];
      }
    }
    dlEvents.push({
      id: `DL-${String(dlEvents.length + 1).padStart(6, "0")}`,
      rawEvent,
      errorMessage,
      createdAt: new Date().toISOString(),
      replayCount: 0,
      lastReplayedAt: null,
      status: "pending",
      replayHistory: [],
    });
    fs.writeFileSync(dlFile, JSON.stringify(dlEvents, null, 2));
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
  let processedCount = 0;
  let failedCount = 0;

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
      const normalized = [];
      for (const event of events) {
        try {
          normalized.push(normalizeEvent(event));
          processedCount++;
        } catch (err) {
          failedCount++;
          deadLetterEvent(event, err.message);
          console.error(`[Indexer] Event dead-lettered: ${err.message}`);
        }
      }

      if (normalized.length > 0) {
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
      }

      console.log(`[Indexer] Indexed ${processedCount} new events. Failed: ${failedCount}.`);
    } else {
      console.log("[Indexer] No new events.");
    }
  } catch (err) {
    console.error("[Indexer] Polling failed after all retries:", err.message);
  }
}

function startWorker() {
  console.log("[Indexer] Starting Soroban contract event indexer...");
  setInterval(pollEvents, POLL_INTERVAL_MS);
}

if (require.main === module) {
  startWorker();
}

export { pollEvents, startWorker };
