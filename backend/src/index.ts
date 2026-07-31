import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { app } from "./app";
import { logStructured } from "./logger";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { invalidateBountyCache } from "./services/bountyStore";

const port = Number(process.env.PORT ?? 3001);
const keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT ?? 65000);
const headersTimeout = Number(process.env.HEADERS_TIMEOUT ?? 66000);

const server = app.listen(port, () => {
  logStructured("info", "server_listen", { port, keepAliveTimeout, headersTimeout });
});

server.keepAliveTimeout = keepAliveTimeout;
server.headersTimeout = headersTimeout;

// Start Soroban indexer in a Worker thread to avoid blocking the event loop.
let indexerWorker: Worker | null = null;

function startIndexerWorker() {
  const workerPath = path.join(__dirname, "..", "worker", "indexer.js");
  let backoff = 1000;
  let worker: Worker;

  const spawn = () => {
    worker = new Worker(workerPath);
    indexerWorker = worker;
    logStructured("info", "indexer_worker_spawn", { pid: worker.threadId });

    worker.on("message", async (msg: any) => {
      if (msg && msg.type === "indexedEvents") {
        try {
          await invalidateBountyCache();
        } catch (err) {
          logStructured("warn", "indexer_cache_invalidation_failed", {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });

    worker.on("exit", (code) => {
      logStructured("warn", "indexer_worker_exit", { code, backoff });
      setTimeout(() => {
        backoff = Math.min(backoff * 2, 30_000);
        spawn();
      }, backoff);
    });

    worker.on("error", (err) => {
      logStructured("error", "indexer_worker_error", { message: err instanceof Error ? err.message : String(err) });
      try {
        worker.terminate();
      } catch {
        /* best effort */
      }
    });
  };

  spawn();
}

// Only start the indexer and expiration job when running the main server (not in tests)
if (process.env.NODE_ENV !== "test") {
  startIndexerWorker();
  startExpirationJob();
}

async function shutdown(signal: string): Promise<void> {
  logStructured("info", "shutdown_initiated", { signal });

  // Mark server as draining so new requests get 503
  setDraining();

  // Stop expiration job before draining connections
  stopExpirationJob();

  // Stop the indexer worker
  if (indexerWorker) {
    try {
      await indexerWorker.terminate();
    } catch {
      /* best effort */
    }
    indexerWorker = null;
  }

  // Give in-flight requests up to DRAIN_TIMEOUT_MS to finish
  const drainTimer = setTimeout(() => {
    logStructured("error", "shutdown_timeout", { drainMs: DRAIN_TIMEOUT_MS });
    process.exit(1);
  }, DRAIN_TIMEOUT_MS);

  // Don't let this timer hold the process open
  drainTimer.unref();

  server.close((err) => {
    if (err) {
      logStructured("error", "shutdown_server_close_error", { message: String(err) });
      process.exit(1);
    }
    logStructured("info", "shutdown_complete");
    process.exit(0);
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
