import type { NextFunction, Request, Response } from 'express';
import { getMiddlewareConfig } from './config';

const config = getMiddlewareConfig();
export const IDEMPOTENCY_TTL_MS = config.idempotencyTtlMs;
export const CLEANUP_INTERVAL_MS = config.idempotencyCleanupIntervalMs;

interface IdempotencyEntry {
  statusCode: number;
  body: unknown;
  createdAt: number;
}

const store = new Map<string, IdempotencyEntry>();

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
  for (const [key, entry] of store) {
    if (entry.createdAt < cutoff) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

cleanupTimer.unref();

/**
 * Replays the first JSON response sent for an `Idempotency-Key` header value
 * (after trimming) for 10 minutes.
 *
 * Requests without the header, or with a blank value, pass through unchanged.
 * On a cache hit it responds with the stored status and body and does not
 * call `next()`. On a miss it wraps `res.json` so the first JSON response is
 * stored, whatever its status code: an error response is replayed too, so a
 * client retrying after a 4xx or 5xx must use a new key. Responses sent with
 * `res.send`/`res.end` instead of `res.json` are not stored.
 *
 * Keys are global, not scoped per route, method, or caller. The same key on a
 * different endpoint returns the cached response.
 *
 * Never throws.
 *
 * Concurrency: the cache is an in-memory `Map` in this process, cleared on
 * restart and not shared across replicas. An entry is written only when the
 * response is sent, so two concurrent requests with the same key that both
 * arrive before either responds will **both** run the handler. This does not
 * replace a store-level uniqueness check.
 *
 * @param req - Incoming request; only the `idempotency-key` header is read.
 * @param res - Response; `res.json` is wrapped on a cache miss.
 * @param next - Called on a cache miss or when no key is supplied.
 */
export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const rawKey = req.headers['idempotency-key'];
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;

  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    next();
    return;
  }

  const trimmedKey = key.trim();
  const now = Date.now();
  const existing = store.get(trimmedKey);

  if (existing) {
    if (now - existing.createdAt < IDEMPOTENCY_TTL_MS) {
      res.status(existing.statusCode).json(existing.body);
      return;
    }
    store.delete(trimmedKey);
  }

  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    store.set(trimmedKey, {
      statusCode: res.statusCode,
      body,
      createdAt: now,
    });
    return originalJson(body);
  };

  next();
}

/**
 * Clears every cached idempotency entry. For tests only; do not call from
 * application code.
 */
export function __resetIdempotencyStoreForTests(): void {
  store.clear();
}
