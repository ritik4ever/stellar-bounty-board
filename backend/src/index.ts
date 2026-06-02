import "dotenv/config";
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
function startIndexerWorker() {
  const workerPath = path.join(__dirname, "..", "worker", "indexer.js");
  let backoff = 1000;
  let worker;

  const spawn = () => {
    worker = new Worker(workerPath);
    logStructured("info", "indexer_worker_spawn", { pid: worker.threadId });

    worker.on("message", async (msg: any) => {
      if (msg && msg.type === "indexedEvents") {
        try {
          // Invalidate bounty cache so reads reflect new on-chain events
          await invalidateBountyCache();
        } catch (err) {
          console.warn("Failed to invalidate bounty cache from indexer message:", err);
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

// Only start the indexer when running the main server (not in tests)
if (process.env.NODE_ENV !== "test") {
  startIndexerWorker();
}
