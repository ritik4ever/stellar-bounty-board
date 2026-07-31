import type { NextFunction, Request, Response } from 'express';

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60_000;

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

export function __resetIdempotencyStoreForTests(): void {
  store.clear();
}
