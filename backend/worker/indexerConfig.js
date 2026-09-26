// Operational settings for the Soroban event indexer worker (#1327).
//
// These used to be hardcoded constants in indexer.js, so tuning them meant a
// code change and a deploy, and their values were invisible to operators.
// They are now read from environment variables; the defaults below are the
// values that were previously hardcoded, so behaviour is unchanged unless an
// operator sets a variable.
//
// Invalid values (non-numeric, zero, negative) never throw: they fall back to
// the default, matching how backend/src/config.ts treats bad env input.

export const INDEXER_DEFAULTS = Object.freeze({
  /** SOROBAN_POLL_INTERVAL — seconds between polls of the RPC events endpoint. */
  pollIntervalSeconds: 10,
  /** SOROBAN_INDEXER_MAX_RETRIES — attempts per poll before giving up (>= 1). */
  maxRetries: 5,
  /** SOROBAN_INDEXER_INITIAL_BACKOFF_MS — first retry delay; doubles each attempt. */
  initialBackoffMs: 1000,
});

function positiveNumber(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(raw, fallback) {
  const value = positiveNumber(raw, fallback);
  return Math.floor(value) >= 1 ? Math.floor(value) : fallback;
}

/**
 * Resolve the indexer's effective operational settings from `env`.
 *
 * @param {Record<string, string | undefined>} [env] Defaults to `process.env`.
 * @returns {{ pollIntervalMs: number, maxRetries: number, initialBackoffMs: number }}
 *   Always fully populated; never throws.
 */
export function loadIndexerConfig(env = process.env) {
  return {
    pollIntervalMs: Math.round(
      positiveNumber(env.SOROBAN_POLL_INTERVAL, INDEXER_DEFAULTS.pollIntervalSeconds) * 1000,
    ),
    maxRetries: positiveInteger(env.SOROBAN_INDEXER_MAX_RETRIES, INDEXER_DEFAULTS.maxRetries),
    initialBackoffMs: Math.round(
      positiveNumber(env.SOROBAN_INDEXER_INITIAL_BACKOFF_MS, INDEXER_DEFAULTS.initialBackoffMs),
    ),
  };
}
