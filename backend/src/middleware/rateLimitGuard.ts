import { logger } from "../logger";

/**
 * Startup guard for the test-only rate-limit bypass (#1465).
 *
 * Rate limiting is disabled only when **two** independent signals agree:
 *
 * | Signal | Variable | Meaning |
 * | --- | --- | --- |
 * | 1 | `NODE_ENV=test` | The process believes it is a test run |
 * | 2 | `RATE_LIMIT_TEST_BYPASS=true` | An explicit, deploy-specific opt-in |
 *
 * Either signal alone changes nothing. `NODE_ENV` is one of the most commonly
 * mismatched variables across environments (a copied `.env`, a platform
 * default, a stale CI variable), so a single `NODE_ENV=test` must not be able
 * to silently strip the rate limiters off a real deployment. The extra flag is
 * deliberately not something a platform sets on its own: it has to be typed
 * into a test runner's environment.
 *
 * `assertRateLimitSafety()` is called once at boot (see `src/index.ts`) and is
 * the enforcement point:
 *
 * - `RATE_LIMIT_TEST_BYPASS=true` without `NODE_ENV=test` → **throws**, so the
 *   process refuses to start. This is the dangerous direction: it means a real
 *   deployment is running with a test flag in its environment.
 * - `NODE_ENV=test` without the bypass flag → does not throw; rate limiting
 *   stays **enabled** (fail closed) and a loud warning is logged, because that
 *   is what a production deploy with a stray `NODE_ENV` looks like.
 * - Both set, or neither → allowed, nothing to report.
 */

/** Explicit opt-in that, together with `NODE_ENV=test`, disables rate limiting. */
export const RATE_LIMIT_TEST_BYPASS_ENV = "RATE_LIMIT_TEST_BYPASS";

/**
 * Whether the explicit bypass flag is set to `"true"`.
 *
 * Only the literal string `"true"` counts — `"1"`, `"yes"` or an empty value do
 * not, so a half-configured environment cannot opt itself out of rate limiting.
 * Read fresh on every call (never memoized) so tests can mutate it.
 */
export function isRateLimitTestBypassSupplied(): boolean {
  return process.env[RATE_LIMIT_TEST_BYPASS_ENV] === "true";
}

/** Whether `NODE_ENV` is exactly `"test"`. Read fresh on every call. */
export function isTestNodeEnv(): boolean {
  return process.env.NODE_ENV === "test";
}

/**
 * Whether rate limiting should actually be disabled for this process.
 *
 * `true` only when `NODE_ENV=test` **and** `RATE_LIMIT_TEST_BYPASS=true`.
 */
export function isRateLimitTestBypassActive(): boolean {
  return isTestNodeEnv() && isRateLimitTestBypassSupplied();
}

/**
 * Refuses to boot a deployment that looks like it has a test flag in it.
 *
 * Call once, before the HTTP server starts listening.
 *
 * @throws {Error} When `RATE_LIMIT_TEST_BYPASS=true` is set while
 *   `NODE_ENV !== "test"`. The message names both variables and the fix.
 *
 * **Side effects:** may emit one `logger.warn` when `NODE_ENV=test` is set
 * without the bypass flag (rate limiting stays on — fail closed).
 *
 * **Concurrency:** synchronous, idempotent, reads `process.env` only. Safe to
 * call from more than one entry point.
 */
export function assertRateLimitSafety(): void {
  const bypassSupplied = isRateLimitTestBypassSupplied();
  const nodeEnvIsTest = isTestNodeEnv();

  if (bypassSupplied && !nodeEnvIsTest) {
    throw new Error(
      `Refusing to start: ${RATE_LIMIT_TEST_BYPASS_ENV}=true disables rate limiting but NODE_ENV is ` +
        `"${process.env.NODE_ENV ?? "undefined"}" instead of "test". This combination looks like a ` +
        `misconfigured deployment, where a test-only flag leaked into a real environment. ` +
        `Unset ${RATE_LIMIT_TEST_BYPASS_ENV} for non-test deployments, or set NODE_ENV=test if this ` +
        `really is a test run.`,
    );
  }

  if (nodeEnvIsTest && !bypassSupplied) {
    logger.warn(
      { nodeEnv: process.env.NODE_ENV, bypassEnvVar: RATE_LIMIT_TEST_BYPASS_ENV },
      `NODE_ENV=test without ${RATE_LIMIT_TEST_BYPASS_ENV}=true; rate limiting stays ENABLED. ` +
        `Set ${RATE_LIMIT_TEST_BYPASS_ENV}=true in the test runner to disable it.`,
    );
  }
}
