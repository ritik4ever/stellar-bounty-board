import Redis from "ioredis";
import { logStructured } from "../logger";

/**
 * Pluggable cache for production multi-instance deployments (#361).
 *
 * A Redis-backed adapter activates when `REDIS_URL` is set so cache is shared
 * across backend replicas and survives restarts; otherwise an in-memory adapter
 * is used. All operations are async and never throw — a backend failure must
 * not take down a request, so cache errors degrade to a miss.
 */
export interface CacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** Process-local cache with per-key TTL. Lost on restart, not shared. */
export class InMemoryCache implements CacheAdapter {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Test helper. */
  clear(): void {
    this.store.clear();
  }
}

/** Redis-backed adapter shared across replicas. Errors degrade to a miss. */
export class RedisCache implements CacheAdapter {
  constructor(private readonly client: Redis) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      logStructured("warn", "redis_get_failed", { key, error: String(error) });
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, "EX", ttlSeconds);
    } catch (error) {
      logStructured("warn", "redis_set_failed", { key, error: String(error) });
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      logStructured("warn", "redis_del_failed", { key, error: String(error) });
    }
  }
}

/** No-op adapter (used in tests so caching never affects fixtures). */
export class NoOpCache implements CacheAdapter {
  async get(): Promise<string | null> {
    return null;
  }
  async set(): Promise<void> {}
  async del(): Promise<void> {}
}

let instance: CacheAdapter | null = null;

/** Singleton cache, chosen from the environment. */
export function getCache(): CacheAdapter {
  if (instance) return instance;

  if (process.env.NODE_ENV === "test") {
    instance = new NoOpCache();
    return instance;
  }

  const url = process.env.REDIS_URL?.trim();
  if (url) {
    const client = new Redis(url, { maxRetriesPerRequest: 2 });
    client.on("error", (error: Error) =>
      logStructured("warn", "redis_connection_error", { error: String(error) }),
    );
    instance = new RedisCache(client);
    logStructured("info", "cache_backend_selected", { backend: "redis" });
  } else {
    instance = new InMemoryCache();
    logStructured("info", "cache_backend_selected", { backend: "memory" });
  }
  return instance;
}

/** Reset the singleton (tests only). */
export function __resetCacheForTests(): void {
  instance = null;
}
