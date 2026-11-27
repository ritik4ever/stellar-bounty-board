import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getMiddlewareConfig } from '../../src/middleware/config';

describe('MiddlewareConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns default values when environment variables are unset', () => {
    delete process.env.DEFAULT_BODY_LIMIT;
    delete process.env.LARGE_BODY_LIMIT;
    delete process.env.IDEMPOTENCY_TTL_MS;
    delete process.env.IDEMPOTENCY_CLEANUP_INTERVAL_MS;
    delete process.env.MAINTAINER_BOUNTY_RATE_LIMIT;
    delete process.env.MAINTAINER_BOUNTY_RATE_WINDOW_MS;
    delete process.env.MAINTAINER_LOCK_RETRIES;
    delete process.env.MAINTAINER_LOCK_MIN_TIMEOUT_MS;
    delete process.env.MAINTAINER_LOCK_MAX_TIMEOUT_MS;
    delete process.env.MAINTAINER_LOCK_STALE_MS;

    const config = getMiddlewareConfig();
    expect(config.defaultBodyLimit).toBe('32kb');
    expect(config.largeBodyLimit).toBe('256kb');
    expect(config.idempotencyTtlMs).toBe(600_000);
    expect(config.idempotencyCleanupIntervalMs).toBe(60_000);
    expect(config.maintainerRateLimit).toBe(10);
    expect(config.maintainerRateWindowMs).toBe(3_600_000);
    expect(config.maintainerLockRetries).toBe(5);
    expect(config.maintainerLockMinTimeoutMs).toBe(10);
    expect(config.maintainerLockMaxTimeoutMs).toBe(50);
    expect(config.maintainerLockStaleMs).toBe(5000);
  });

  it('respects valid environment variable overrides', () => {
    process.env.DEFAULT_BODY_LIMIT = '64kb';
    process.env.LARGE_BODY_LIMIT = '512kb';
    process.env.IDEMPOTENCY_TTL_MS = '1200000';
    process.env.IDEMPOTENCY_CLEANUP_INTERVAL_MS = '120000';
    process.env.MAINTAINER_BOUNTY_RATE_LIMIT = '25';
    process.env.MAINTAINER_BOUNTY_RATE_WINDOW_MS = '7200000';
    process.env.MAINTAINER_LOCK_RETRIES = '10';
    process.env.MAINTAINER_LOCK_MIN_TIMEOUT_MS = '20';
    process.env.MAINTAINER_LOCK_MAX_TIMEOUT_MS = '100';
    process.env.MAINTAINER_LOCK_STALE_MS = '10000';

    const config = getMiddlewareConfig();
    expect(config.defaultBodyLimit).toBe('64kb');
    expect(config.largeBodyLimit).toBe('512kb');
    expect(config.idempotencyTtlMs).toBe(1_200_000);
    expect(config.idempotencyCleanupIntervalMs).toBe(120_000);
    expect(config.maintainerRateLimit).toBe(25);
    expect(config.maintainerRateWindowMs).toBe(7_200_000);
    expect(config.maintainerLockRetries).toBe(10);
    expect(config.maintainerLockMinTimeoutMs).toBe(20);
    expect(config.maintainerLockMaxTimeoutMs).toBe(100);
    expect(config.maintainerLockStaleMs).toBe(10_000);
  });

  it('falls back to safe defaults on invalid/negative inputs', () => {
    process.env.IDEMPOTENCY_TTL_MS = '-500';
    process.env.MAINTAINER_BOUNTY_RATE_LIMIT = 'invalid';
    process.env.MAINTAINER_LOCK_STALE_MS = '0';

    const config = getMiddlewareConfig();
    expect(config.idempotencyTtlMs).toBe(600_000);
    expect(config.maintainerRateLimit).toBe(10);
    expect(config.maintainerLockStaleMs).toBe(5000);
  });
});
