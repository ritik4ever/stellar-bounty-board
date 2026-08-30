import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logger';

const TTL_SECONDS = Number(process.env.IDEMPOTENCY_TTL_SECONDS) || 600;
const IDEMPOTENCY_TTL_MS = TTL_SECONDS * 1000;
const CLEANUP_INTERVAL_MS = 60_000;

interface IdempotencyEntry {
  statusCode: number;
  body: unknown;
  createdAt: number;
}

const store = new Map<string, IdempotencyEntry>();

const cleanupTimer = process.env.NODE_ENV !== 'test' ? setInterval(() => {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
  let purgedCount = 0;
  for (const [key, entry] of store) {
    if (entry.createdAt < cutoff) {
      store.delete(key);
      purgedCount++;
    }
  }
  if (purgedCount > 0) {
    logger.info({ purgedCount }, 'Cleaned up expired idempotency keys');
  }
}, CLEANUP_INTERVAL_MS) : null;

if (cleanupTimer) {
  cleanupTimer.unref();
}

export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
}

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
