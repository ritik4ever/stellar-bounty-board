// Soroban Contract Event Indexer Worker
// Polls contract events and normalizes them for backend use.
//
// ESM (.mjs) so it can run as a worker_thread even in a CommonJS backend
// package. Poll cadence and backoff limits are configurable via environment
// variables (issue #809).

import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { parentPort } from "node:worker_threads";

// CONFIGURATION
const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID || ""; // Set in env
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || "https://rpc-futurenet.stellar.org";
// Base polling interval in milliseconds (issue #809). Configurable via
// SOROBAN_POLL_INTERVAL_MS; defaults to 10 seconds.
const POLL_INTERVAL_MS = positiveIntFromEnv(
  process.env.SOROBAN_POLL_INTERVAL_MS,
  10000,
  "SOROBAN_POLL_INTERVAL_MS"
);
// Maximum exponential backoff delay between polls after repeated RPC errors
// (issue #809). Configurable via SOROBAN_MAX_BACKOFF_MS; defaults to 5 minutes.
const MAX_BACKOFF_MS = positiveIntFromEnv(
  process.env.SOROBAN_MAX_BACKOFF_MS,
  5 * 60 * 1000,
  "SOROBAN_MAX_BACKOFF_MS"
);
// Retries performed within a single poll before it is reported as failed and
// the poll-level backoff kicks in. Configurable via SOROBAN_MAX_RETRIES;
// defaults to 5.
const MAX_RETRIES = positiveIntFromEnv(process.env.SOROBAN_MAX_RETRIES, 5, "SOROBAN_MAX_RETRIES");
const INITIAL_BACKOFF_MS = 1000;
const INDEX_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "indexed-events.json");

/**
 * Parses a positive integer from an environment variable, falling back to
 * `fallback` when the value is missing or invalid so a bad config can never
 * break the poll schedule (issue #809).
 */
function positiveIntFromEnv(raw, fallback, name) {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[Indexer] Invalid ${name}="${raw}", falling back to ${fallback}ms.`);
    return fallback;
  }
  return parsed;
}

// Retry wrapper with exponential backoff (within a single poll attempt)
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
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
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

// Poll Soroban contract events. Returns true when the poll completed
// successfully (events fetched and saved), false when it failed after all
// retries so the scheduler can back off (issue #809).
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
    return true;
  } catch (err) {
    console.error("[Indexer] Polling failed after all retries:", err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Poll scheduler with exponential backoff (issue #809)
// ---------------------------------------------------------------------------
// Polls are self-scheduled with setTimeout (not setInterval) so a failed poll
// can delay the next attempt exponentially. Backoff doubles the poll interval
// for every consecutive failure, caps at MAX_BACKOFF_MS, and resets to the
// base interval after the first successful poll.

let pollTimer = null;
let consecutiveFailures = 0;

function scheduleNextPoll(delayMs) {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }
  pollTimer = setTimeout(runPollCycle, delayMs);
}

async function runPollCycle() {
  const ok = await pollEvents();
  if (ok) {
    if (consecutiveFailures > 0) {
      console.log(
        `[Indexer] Backoff reset: poll succeeded after ${consecutiveFailures} consecutive failure(s); next poll in ${POLL_INTERVAL_MS}ms.`
      );
      consecutiveFailures = 0;
    }
    scheduleNextPoll(POLL_INTERVAL_MS);
  } else {
    consecutiveFailures += 1;
    const backoffMs = Math.min(
      POLL_INTERVAL_MS * Math.pow(2, consecutiveFailures),
      MAX_BACKOFF_MS
    );
    const atCap = backoffMs >= MAX_BACKOFF_MS;
    console.log(
      `[Indexer] Backoff entered: RPC failure #${consecutiveFailures}; next poll in ${backoffMs}ms${atCap ? " (capped at max backoff)" : ""}.`
    );
    scheduleNextPoll(backoffMs);
  }
}

function startWorker() {
  console.log(
    `[Indexer] Starting Soroban contract event indexer (poll interval ${POLL_INTERVAL_MS}ms, max backoff ${MAX_BACKOFF_MS}ms).`
  );
  // Fire the first poll immediately, then keep re-scheduling.
  runPollCycle();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWorker();
}

export { pollEvents, startWorker };
