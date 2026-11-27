type Result = { status: number; body: unknown };
type Entry = { fingerprint: string; promise: Promise<Result>; expiresAt: number };

const TTL_MS = 24 * 60 * 60 * 1000;
const store = new Map<string, Entry>();

export class IdempotencyKeyReuseError extends Error {}

export async function runIdempotent(
  key: string,
  fingerprint: string,
  exec: () => Promise<Result>,
): Promise<{ result: Result; replayed: boolean }> {
  const now = Date.now();
  for (const [k, e] of store) if (e.expiresAt <= now) store.delete(k);

  const existing = store.get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new IdempotencyKeyReuseError();
    return { result: await existing.promise, replayed: true };
  }

  const promise = exec();
  store.set(key, { fingerprint, promise, expiresAt: now + TTL_MS });
  try {
    const result = await promise;
    if (result.status >= 300) store.delete(key); // cache successes only
    return { result, replayed: false };
  } catch (err) {
    store.delete(key); // allow a retry after a failure
    throw err;
  }
}

export function resetIdempotencyStore() {
  store.clear(); // for tests
}
