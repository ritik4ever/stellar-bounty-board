import { Request, Response, NextFunction, RequestHandler } from "express";
import fs from "fs";
import path from "path";
import lockfile from "proper-lockfile";
import { logger } from "../logger";
import { MiddlewareDependencyError } from "./errors";
import { isRateLimitTestBypassActive } from "./rateLimitGuard";

const LIMIT = Number(process.env.MAINTAINER_BOUNTY_RATE_LIMIT ?? 10);
const WINDOW_MS = Number(process.env.MAINTAINER_BOUNTY_RATE_WINDOW_MS ?? 3600_000);

interface RateLimitRecord {
  timestamps: number[];
}

function getStorePath(): string {
  if (process.env.MAINTAINER_RATE_LIMIT_STORE_PATH?.trim()) {
    return path.resolve(process.env.MAINTAINER_RATE_LIMIT_STORE_PATH.trim());
  }
  if (process.env.BOUNTY_STORE_PATH?.trim()) {
    return path.resolve(path.dirname(process.env.BOUNTY_STORE_PATH.trim()), "maintainer_rate_limits.json");
  }
  return path.resolve(process.cwd(), "data", "maintainer_rate_limits.json");
}

function ensureStore(storePath: string) {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({}));
  }
}

const STORE_UNAVAILABLE_MESSAGE = "Rate limit store is unavailable, please try again.";

function storeError(operation: string, cause: unknown): MiddlewareDependencyError {
  return new MiddlewareDependencyError({
    operation: `maintainer_rate_limit.${operation}`,
    dependency: "json-store",
    statusCode: 503,
    publicMessage: STORE_UNAVAILABLE_MESSAGE,
    cause,
  });
}

async function releaseQuietly(release: () => Promise<void>, storePath: string): Promise<void> {
  try {
    await release();
  } catch (err) {
    // The lock goes stale after `stale` ms, so a failed release only delays
    // the next writer; it must not fail a request whose work already finished.
    logger.warn({ err, storePath }, "maintainer_rate_limit_release_failed");
  }
}

/**
 * Per-maintainer rate limit on bounty creation: at most
 * `MAINTAINER_BOUNTY_RATE_LIMIT` (default 10) requests per rolling
 * `MAINTAINER_BOUNTY_RATE_WINDOW_MS` (default 1h) for each `body.maintainer`.
 * Both are read **once at module load**.
 *
 * Passes through (calls `next()`) when the test bypass is active —
 * `NODE_ENV=test` **and** the explicit `RATE_LIMIT_TEST_BYPASS=true` opt-in
 * (#1465, see `./rateLimitGuard.ts`) — or when `body.maintainer` is not a
 * non-empty string (body validation rejects those). `NODE_ENV=test` alone no
 * longer disables this limit.
 * Must run after `express.json()`.
 *
 * Over the limit it responds 429 with a `Retry-After` header (seconds until
 * the oldest request in the window expires). An allowed request is counted
 * **before** `next()` is called, so it counts against the limit even if the
 * route later rejects it.
 *
 * Timestamps are persisted as JSON at `MAINTAINER_RATE_LIMIT_STORE_PATH`, or
 * `maintainer_rate_limits.json` beside `BOUNTY_STORE_PATH`, or
 * `./data/maintainer_rate_limits.json`. The file and its directory are
 * created when missing. A file that is unparseable or not a JSON object is
 * treated as empty and overwritten on the next write; a malformed entry for a
 * maintainer is treated as having no prior requests.
 *
 * Never throws and never rejects. Dependency failures go to `next()` as a
 * {@link MiddlewareDependencyError}:
 *  - `maintainer_rate_limit.acquire_lock` (`file-lock`, 503 "Service busy")
 *    when the lock cannot be taken after 5 quick retries.
 *  - `maintainer_rate_limit.init_store` / `read_store` / `write_store`
 *    (`json-store`, 503) when the file cannot be created, read, or written.
 * A failed lock release is logged and ignored.
 *
 * Concurrency: each read-modify-write runs under a `proper-lockfile` lock on
 * the store file, so it is safe across concurrent requests and across
 * processes sharing the file. A lock older than 5s is treated as stale and
 * taken over.
 */
export const maintainerLimiter: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (isRateLimitTestBypassActive()) {
    next();
    return;
  }

  const maintainer = req.body?.maintainer;
  if (!maintainer || typeof maintainer !== "string") {
    next();
    return;
  }

  const storePath = getStorePath();
  try {
    ensureStore(storePath);
  } catch (err) {
    next(storeError("init_store", err));
    return;
  }

  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(storePath, {
      retries: { retries: 5, minTimeout: 10, maxTimeout: 50 },
      stale: 5000,
    });
  } catch (err) {
    next(
      new MiddlewareDependencyError({
        operation: "maintainer_rate_limit.acquire_lock",
        dependency: "file-lock",
        statusCode: 503,
        publicMessage: "Service busy, please try again.",
        cause: err,
      }),
    );
    return;
  }

  let operation = "read_store";
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    let store: Record<string, RateLimitRecord> = {};
    try {
      const parsed: unknown = JSON.parse(raw);
      // Valid JSON that is not an object (null, a number, an array) would
      // either throw on lookup or silently drop writes, disabling the limit.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        store = parsed as Record<string, RateLimitRecord>;
      }
    } catch {
      // Ignore parse error and start fresh
    }

    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    const existing = store[maintainer];
    const record: RateLimitRecord = {
      timestamps: Array.isArray(existing?.timestamps)
        ? existing.timestamps.filter((ts): ts is number => typeof ts === "number")
        : [],
    };

    // Clean up old timestamps
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    if (record.timestamps.length >= LIMIT) {
      const oldest = record.timestamps[0];
      const resetTime = oldest + WINDOW_MS;
      const retryAfter = Math.ceil((resetTime - now) / 1000);

      await releaseQuietly(release, storePath);

      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Too many requests. Please retry later." });
      return;
    }

    record.timestamps.push(now);
    store[maintainer] = record;
    operation = "write_store";
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
  } catch (err) {
    await releaseQuietly(release, storePath);
    next(storeError(operation, err));
    return;
  }

  await releaseQuietly(release, storePath);
  next();
};
