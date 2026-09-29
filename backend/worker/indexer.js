// Soroban Contract Event Indexer Worker
// Polls contract events and normalizes them for backend use

import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import { loadIndexerConfig } from "./indexerConfig.js";
import { createCorrelationLogger, resolveWorkerCorrelationId } from "./correlation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CONFIGURATION
const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID || ""; // Set in env
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || "https://rpc-futurenet.stellar.org";
const INDEX_FILE = path.join(__dirname, "indexed-events.json");

// Correlation id for this worker session (#1457). The parent process passes one
// through `workerData`; a standalone run mints its own. Every log line carries
// it and the `indexedEvents` message echoes it back to the backend so one id
// links the API request and the worker work it triggered.
const CORRELATION_ID = resolveWorkerCorrelationId(workerData);
const log = createCorrelationLogger(CORRELATION_ID);

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
        log.info(
          `Retry attempt ${attempt + 1}/${maxRetries} after ${backoffMs}ms. Error: ${err.message}`,
        );
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      } else {
        log.error(`All ${maxRetries} retries exhausted. Last error:`, err.message);
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
    parentPort.postMessage({ type: "indexedEvents", correlationId: CORRELATION_ID, events });
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
      log.info(`Indexed ${events.length} new events.`);
    } else {
      log.info("No new events.");
    }
  } catch (err) {
    log.error("Polling failed after all retries:", err.message);
  }
}

function startWorker() {
  log.info("Starting Soroban contract event indexer...");
  // Deliberately omits SOROBAN_RPC_URL: some RPC providers embed an API key in it.
  log.info(
    `Effective config: pollIntervalMs=${POLL_INTERVAL_MS} ` +
      `maxRetries=${MAX_RETRIES} initialBackoffMs=${INITIAL_BACKOFF_MS}`,
  );
  setInterval(pollEvents, POLL_INTERVAL_MS);
}

/** True when this module is running inside a worker_threads Worker. */
function isWorkerThread() {
  return Boolean(parentPort);
}

/** True when this module is the process entrypoint (`node indexer.js`). */
function isEntrypoint() {
  if (isWorkerThread()) return true;
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isEntrypoint()) {
  startWorker();
}

export { pollEvents, startWorker };
