import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertRateLimitSafety,
  isRateLimitTestBypassActive,
  isRateLimitTestBypassSupplied,
  isTestNodeEnv,
  RATE_LIMIT_TEST_BYPASS_ENV,
} from '../src/middleware/rateLimitGuard';

/**
 * #1465 — `NODE_ENV=test` must not be able to disable rate limiting on its own.
 *
 * The unit under test reads `process.env` fresh on every call, so each case can
 * stub the environment directly.
 */
describe('rate limit test bypass guard (#1465)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires both NODE_ENV=test and the explicit opt-in to disable rate limiting', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, 'true');
    expect(isRateLimitTestBypassActive()).toBe(true);

    vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, '');
    expect(isRateLimitTestBypassActive()).toBe(false);

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, 'true');
    expect(isRateLimitTestBypassActive()).toBe(false);
  });

  it('does not treat a non-literal opt-in value as consent', () => {
    vi.stubEnv('NODE_ENV', 'test');

    for (const value of ['1', 'yes', 'TRUE', ' true', 'on']) {
      vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, value);
      expect(isRateLimitTestBypassSupplied()).toBe(false);
      expect(isRateLimitTestBypassActive()).toBe(false);
    }
  });

  it('reports the two signals independently', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, 'true');
    expect(isTestNodeEnv()).toBe(true);
    expect(isRateLimitTestBypassSupplied()).toBe(true);

    vi.stubEnv('NODE_ENV', 'staging');
    expect(isTestNodeEnv()).toBe(false);
    expect(isRateLimitTestBypassSupplied()).toBe(true);
  });

  describe('assertRateLimitSafety', () => {
    it('refuses to boot when the bypass flag is set outside a test run', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, 'true');

      expect(() => assertRateLimitSafety()).toThrow(/Refusing to start/);
      expect(() => assertRateLimitSafety()).toThrow(/NODE_ENV is "production" instead of "test"/);
    });

    it('names both variables in the failure so the misconfiguration is obvious', () => {
      vi.stubEnv('NODE_ENV', 'staging');
      vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, 'true');

      let message = '';
      try {
        assertRateLimitSafety();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain(RATE_LIMIT_TEST_BYPASS_ENV);
      expect(message).toContain('NODE_ENV');
    });

    it('treats a missing NODE_ENV as a real environment, not a test one', () => {
      vi.stubEnv('NODE_ENV', '');
      vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, 'true');

      expect(() => assertRateLimitSafety()).toThrow(/Refusing to start/);
    });

    it('allows the bypass inside a real test run', () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, 'true');

      expect(() => assertRateLimitSafety()).not.toThrow();
    });

    it('allows a normal deployment (no bypass flag anywhere)', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, '');

      expect(() => assertRateLimitSafety()).not.toThrow();
    });

    it('does not throw but warns when NODE_ENV=test lacks the opt-in, so rate limiting stays on', () => {
      // This is the shape of a production deploy that inherited a stray
      // NODE_ENV=test: it must keep running with rate limiting enabled.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, '');

      expect(() => assertRateLimitSafety()).not.toThrow();
      warn.mockRestore();
    });

    it('is idempotent and safe to call more than once', () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv(RATE_LIMIT_TEST_BYPASS_ENV, 'true');

      expect(() => {
        assertRateLimitSafety();
        assertRateLimitSafety();
      }).not.toThrow();
    });
  });
});
