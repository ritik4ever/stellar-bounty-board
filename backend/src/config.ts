/**
 * Public runtime configuration for the Stellar Bounty Board platform.
 *
 * Values here are sourced from environment variables so the frontend and
 * contract-interaction layer stay in sync without hardcoding anything.
 * ONLY non-sensitive, UI-facing values are exposed — never secrets, DB
 * connection strings, API keys, or internal service URLs.
 *
 * ## Contract for callers
 *
 * - **Nothing here throws on bad configuration.** Every environment variable
 *   is parsed defensively: a missing, non-numeric, or out-of-range value
 *   silently falls back to that field's documented default rather than
 *   raising. Callers do not need `try`/`catch` for malformed env values, and
 *   should not expect `null` / `undefined` in any field of the result —
 *   every field of {@link PublicConfig} is always populated.
 * - **Because of that, misconfiguration is silent.** A typo'd
 *   `PROTOCOL_FEE_BPS` yields `feeBps: 0`, not an error. If you need to
 *   detect a bad value, validate the raw env var yourself.
 * - **Nothing is cached.** Environment variables are re-read on every call
 *   (see {@link getPublicConfig} for the concurrency implications).
 */

import { getTokenAddressMap } from './utils';

/**
 * Shape of the public, non-sensitive configuration returned by
 * {@link getPublicConfig} and served (as `{ data: PublicConfig }`) from
 * `GET /api/config`.
 *
 * Every field is always present and always a valid value of its type; see
 * each field for the environment variable it is read from, its default, and
 * how invalid input is handled.
 */
export interface PublicConfig {
  /**
   * Protocol fee in basis points (100 bps = 1 %).
   * Matches the `protocol_fee_bps` argument accepted by the Soroban contract's
   * `create_bounty` instruction.  0 = no protocol fee.
   *
   * Source: `PROTOCOL_FEE_BPS`. Default: `0`. The parsed value is floored to
   * an integer. A value that is non-numeric, negative, or greater than
   * `10000` is **not clamped** — it falls back to `0`.
   */
  feeBps: number;

  /**
   * Minimum seconds that must elapse after a dispute is raised before an
   * arbiter can resolve it.  Mirrors the `dispute_window` set on the contract
   * during `initialize`.
   *
   * Source: `DISPUTE_WINDOW_SECONDS`. Default: `0`. Floored to an integer;
   * non-numeric or negative values fall back to `0`.
   */
  disputeWindowSeconds: number;

  /**
   * Minimum bounty amount in the bounty token.
   * Enforced by `validateBountyAmount` in the API layer.
   *
   * Source: `MIN_BOUNTY_AMOUNT`. Default: `1`. Must be a finite number
   * greater than `0` (fractions allowed, not rounded); otherwise falls back
   * to `1`.
   *
   * Note: this is **not** cross-checked against {@link PublicConfig.maxBountyAmount}.
   * If both are set inconsistently (min > max) they are returned as-is.
   */
  minBountyAmount: number;

  /**
   * Maximum bounty amount in the bounty token.
   * Enforced by `validateBountyAmount` in the API layer.
   *
   * Source: `MAX_BOUNTY_AMOUNT`. Default: `10000`. Must be a finite number
   * greater than `0` (fractions allowed, not rounded); otherwise falls back
   * to `10000`. Not cross-checked against {@link PublicConfig.minBountyAmount}.
   */
  maxBountyAmount: number;

  /**
   * Token symbols that can be used when creating a bounty, together with
   * their resolved Soroban contract addresses.
   *
   * Example: { XLM: "CAS3J7...", USDC: "CCW677..." }
   *
   * Keys are upper-cased symbols. The set of symbols is `ALLOWED_TOKEN_SYMBOLS`
   * (comma-separated; entries are trimmed and upper-cased) when set to at
   * least one non-empty entry, otherwise every symbol known to
   * `getTokenAddressMap()`. Addresses always come from `getTokenAddressMap()`
   * (built-in defaults, overridden by `TOKEN_ADDRESS_MAP` JSON and
   * `TOKEN_ADDR_<SYMBOL>` / `TOKEN_ADDRESS_<SYMBOL>` variables).
   *
   * A symbol listed in `ALLOWED_TOKEN_SYMBOLS` that has no known address is
   * **silently omitted** (no error), so this object may be empty. Malformed
   * `TOKEN_ADDRESS_MAP` JSON is ignored with a `console.warn`, not thrown.
   *
   * Known quirk (in `getTokenAddressMap`, not this module): because that
   * function also scans for `TOKEN_ADDRESS_<SYMBOL>` variables, setting
   * `TOKEN_ADDRESS_MAP` at all (valid *or* malformed) adds a bogus `MAP` entry
   * whose "address" is the raw variable value. It only appears here when
   * `ALLOWED_TOKEN_SYMBOLS` is unset (the allowlist otherwise filters it out
   * unless it lists `MAP`). Set `ALLOWED_TOKEN_SYMBOLS` explicitly to avoid it.
   */
  supportedTokens: Record<string, string>;

  /**
   * Default reservation TTL in seconds.  After this window a held reservation
   * is automatically returned to `open` by the expiration job.
   *
   * Source: `RESERVATION_TTL_DAYS` (**days**, converted to seconds and
   * rounded to the nearest whole second, so fractional days are allowed).
   * Default: `604800` (7 days). Must be a finite number greater than `0`;
   * otherwise falls back to `604800`.
   */
  defaultReservationTtlSeconds: number;

  /**
   * Soroban network the backend is connected to (e.g. "testnet", "futurenet",
   * "mainnet").
   *
   * Resolved in this order:
   * 1. `SOROBAN_NETWORK_PASSPHRASE` containing `"Public Global"` → `"mainnet"`
   * 2. …containing `"Test SDF Network"` → `"testnet"`
   * 3. …containing `"Test SDF Future Network"` → `"futurenet"`
   * 4. otherwise the value of `STELLAR_NETWORK`, **returned verbatim and
   *    unvalidated** (so it may be any string), or `"futurenet"` if unset.
   */
  network: string;
}

/**
 * Map a Soroban network passphrase to a human-readable label.
 *
 * Not exported. Reads `SOROBAN_NETWORK_PASSPHRASE` / `STELLAR_NETWORK` on each
 * call; never throws. See {@link PublicConfig.network} for the resolution order.
 */
function resolveNetworkLabel(): string {
  const passphrase = process.env.SOROBAN_NETWORK_PASSPHRASE ?? '';
  if (passphrase.includes('Public Global')) return 'mainnet';
  if (passphrase.includes('Test SDF Network')) return 'testnet';
  if (passphrase.includes('Test SDF Future Network')) return 'futurenet';
  return process.env.STELLAR_NETWORK ?? 'futurenet';
}

/**
 * Build the public config object from environment variables.
 *
 * Sensitive variables (GITHUB_WEBHOOK_SECRET, DATABASE_URL, ADMIN_API_KEY_HASH,
 * MAINTAINER_PUBLIC_KEY, SENDGRID_API_KEY, etc.) are never included.
 *
 * @returns A freshly built {@link PublicConfig}. Every field is always
 *   populated (never `null` / `undefined`); see the individual fields for
 *   their environment variable, default, and fallback rules.
 *
 * @throws Nothing is thrown for malformed, missing, or out-of-range
 *   environment values — they fall back to defaults (see the module-level
 *   contract above). Callers such as `GET /api/config` wrap the call in a
 *   `try`/`catch` only as a safety net against unexpected runtime failures,
 *   not because a bad env value can reach it.
 *
 * @remarks
 * **Concurrency / state assumptions**
 * - Synchronous and side-effect free apart from a possible `console.warn`
 *   (malformed `TOKEN_ADDRESS_MAP`). No I/O, no module-level state, no
 *   memoization.
 * - Reads `process.env` fresh on every call and returns a **new object** (and
 *   a new `supportedTokens` map) each time, so concurrent callers never share
 *   mutable state and mutating a returned object does not affect other
 *   callers.
 * - Consequently the result reflects `process.env` *at call time*: if the
 *   environment is mutated while the process runs (e.g. in tests), successive
 *   calls can return different values. Nothing in this module observes or
 *   guards against that.
 * - The returned object is not frozen.
 *
 * @example
 * ```ts
 * const { feeBps, supportedTokens } = getPublicConfig();
 * // No try/catch needed for bad env values; feeBps is always a number.
 * ```
 */
export function getPublicConfig(): PublicConfig {
  const feeBps = (() => {
    const raw = process.env.PROTOCOL_FEE_BPS;
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10_000 ? Math.floor(parsed) : 0;
  })();

  const disputeWindowSeconds = (() => {
    const raw = process.env.DISPUTE_WINDOW_SECONDS;
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  })();

  const minBountyAmount = (() => {
    const raw = process.env.MIN_BOUNTY_AMOUNT;
    if (!raw) return 1;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  })();

  const maxBountyAmount = (() => {
    const raw = process.env.MAX_BOUNTY_AMOUNT;
    if (!raw) return 10_000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
  })();

  const defaultReservationTtlSeconds = (() => {
    const raw = process.env.RESERVATION_TTL_DAYS;
    if (!raw) return 604_800; // 7 days
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 86_400) : 604_800;
  })();

  // Build the token map — only expose symbols that are in the allowlist.
  const allowedSymbols = (() => {
    const configured = process.env.ALLOWED_TOKEN_SYMBOLS?.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (configured && configured.length > 0) return configured;
    return Object.keys(getTokenAddressMap());
  })();

  const fullMap = getTokenAddressMap();
  const supportedTokens: Record<string, string> = {};
  for (const symbol of allowedSymbols) {
    if (fullMap[symbol]) {
      supportedTokens[symbol] = fullMap[symbol];
    }
  }

  return {
    feeBps,
    disputeWindowSeconds,
    minBountyAmount,
    maxBountyAmount,
    supportedTokens,
    defaultReservationTtlSeconds,
    network: resolveNetworkLabel(),
  };
}
