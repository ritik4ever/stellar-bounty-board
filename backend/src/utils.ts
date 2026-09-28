import type { Request, RequestHandler, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { StrKey } from "@stellar/stellar-sdk";
import { getOperationalConfig } from "./config";
import { isRateLimitTestBypassActive } from "./middleware/rateLimitGuard";

/**
 * Rate limiting (#349, #1460).
 *
 * Three tiers, all configurable via env:
 *  - `readLimiter`     — global, GET-only, generous (default 120 req/min/IP).
 *  - `mutationLimiter` — strict, applied to state-changing routes
 *    (create / reserve / submit / release / refund) so a single client cannot
 *    hammer them (default 10 req/min/IP), independent of the read limit.
 *  - `webhookLimiter`  — dedicated to `POST /api/webhooks/github`
 *    (default 300 req/min/IP). GitHub is the expected caller there, so it gets
 *    its own ceiling instead of borrowing the browser-facing one (#1460).
 *
 * Standard `RateLimit-*` headers are returned on every response; 429 responses
 * additionally carry a `Retry-After` header.
 *
 * Configuration is sourced from environment variables via `getOperationalConfig()`.
 * See backend/src/config.ts for details.
 *
 * All three limiters are disabled only when {@link isRateLimitTestBypassActive}
 * says so — `NODE_ENV=test` **and** the explicit `RATE_LIMIT_TEST_BYPASS=true`
 * opt-in (#1465). `NODE_ENV=test` on its own leaves them enabled, and
 * `assertRateLimitSafety()` refuses to boot when the opt-in appears outside a
 * test run.
 */
const config = getOperationalConfig();
const WINDOW_MS = config.rateLimitWindowMs;
const READ_MAX = config.rateLimitReadMax;
const MUTATION_MAX = config.rateLimitMutationMax;
const WEBHOOK_MAX = config.rateLimitWebhookMax;

const HEALTH_PATHS = new Set(["/api/health", "/api/health/deep", "/worker/health"]);

function isHealthPath(req: Request): boolean {
  return HEALTH_PATHS.has(req.path);
}

/** No-op middleware, used when the limiter is disabled for a test run. */
const passthrough: RequestHandler = (_req, _res, next) => next();

/** Options accepted by {@link createRateLimiter}. */
export interface RateLimiterOptions {
  /** Maximum requests allowed per window, per client. */
  limit: number;
  /** Window length in milliseconds. Defaults to `RATE_LIMIT_WINDOW_MS`. */
  windowMs?: number;
  /** Match only `GET` requests and skip health probes (used by the read tier). */
  getOnly?: boolean;
  /**
   * Override whether this limiter is switched off.
   *
   * Omitted (the production default) → disabled only when the test bypass is
   * active. Pass `false` to build an always-on limiter, which is how the
   * limiter behaviour itself is tested.
   */
  disabled?: boolean;
}

/**
 * Builds an `express-rate-limit` middleware with the shared behaviour of every
 * tier: draft-8 `RateLimit-*` headers, no legacy headers, `/56` IPv6 grouping,
 * a `Retry-After` header and a JSON body on 429.
 *
 * **Synchronous, no I/O.** The returned middleware keeps its counters in the
 * in-process store (per worker); it is not shared across instances.
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const { limit, windowMs = WINDOW_MS, getOnly = false } = options;
  const disabled = options.disabled ?? isRateLimitTestBypassActive();

  if (disabled) {
    return passthrough;
  }

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ipv6Subnet: 56,
    ...(getOnly
      ? { skip: (req: Request) => req.method !== "GET" || isHealthPath(req) }
      : {}),
    handler: (_req: Request, res: Response) => {
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      res.status(429).json({ error: "Too many requests. Please retry later." });
    },
  });
}

/**
 * Global read limit middleware (GET only): generous rate limit to protect against scraping.
 *
 * **Configuration (environment variables):**
 * - `RATE_LIMIT_WINDOW_MS`: Time window in milliseconds (default: 60000 ms / 1 minute)
 * - `RATE_LIMIT_READ_MAX`: Maximum GET requests per window per IP (default: 120)
 *
 * **Behavior:**
 * - Applied to all GET requests globally
 * - Skips health check endpoints (`/api/health`, `/api/health/deep`, `/worker/health`)
 * - Disabled only when `NODE_ENV=test` **and** `RATE_LIMIT_TEST_BYPASS=true` (#1465)
 * - Returns standard `RateLimit-*` draft-8 headers on all responses
 * - Returns 429 with `Retry-After` header when limit is exceeded
 *
 * **Concurrency:** Thread-safe via express-rate-limit's default in-process store
 * (or Redis-backed when `REDIS_URL` is configured).
 */
export const readLimiter: RequestHandler = createRateLimiter({ limit: READ_MAX, getOnly: true });

/**
 * Strict rate limit middleware for state-changing mutation routes.
 *
 * **Configuration (environment variables):**
 * - `RATE_LIMIT_WINDOW_MS`: Time window in milliseconds (default: 60000 ms / 1 minute)
 * - `RATE_LIMIT_MUTATION_MAX`: Maximum mutation requests per window per IP (default: 10)
 *
 * **Behavior:**
 * - Applied to POST/PATCH/DELETE mutation endpoints (reserve, submit, release, refund, etc.)
 * - Prevents a single client from hammering state-changing operations
 * - Independent of {@link readLimiter} — both limits apply to their respective operations
 * - Disabled only when `NODE_ENV=test` **and** `RATE_LIMIT_TEST_BYPASS=true` (#1465)
 * - Returns standard `RateLimit-*` draft-8 headers on all responses
 * - Returns 429 with `Retry-After` header when limit is exceeded
 *
 * **Concurrency:** Thread-safe via express-rate-limit's default in-process store
 * (or Redis-backed when `REDIS_URL` is configured).
 */
export const mutationLimiter: RequestHandler = createRateLimiter({ limit: MUTATION_MAX });

/**
 * Dedicated rate limit middleware for the GitHub webhook receiver (#1460).
 *
 * **Configuration (environment variables):**
 * - `RATE_LIMIT_WINDOW_MS`: Time window in milliseconds (default: 60000 ms / 1 minute)
 * - `RATE_LIMIT_WEBHOOK_MAX`: Maximum webhook deliveries per window per IP (default: 300)
 *
 * **Why the webhook route needs its own ceiling:**
 * The webhook endpoint has a different threat model from the rest of the API.
 * Its legitimate caller is GitHub, not a browser, so neither existing tier
 * fits:
 * - Reusing the read limit (120/min) would be *tighter* than required for a
 *   POST route and would throttle a legitimate delivery burst; the read tier is
 *   also globally GET-only, so it never covers this route at all.
 * - Reusing the mutation limit (10/min) would drop real deliveries: a single
 *   busy repository can emit dozens of `pull_request` events in the minutes
 *   around a merge, and every dropped delivery has to be redelivered by hand.
 * - Leaving the route unlimited, as it was, means a spoofed flood is answered
 *   (401) as fast as the process can sign nothing — cheap CPU burn and a lot of
 *   log noise, with no ceiling at all.
 *
 * 300/min per IP (5 requests/second sustained) is the chosen ceiling. It is
 * ~2.5x the read tier, comfortably above observed delivery bursts for this
 * service, and still a hard cap: a single source cannot hold the CPU. Because
 * GitHub delivers from a documented pool of addresses, per-IP keying also means
 * one abusive source cannot slow deliveries from the rest of GitHub's pool.
 *
 * **Reverse-proxy caveat:** keying uses `req.ip`. This app never calls
 * `app.set('trust proxy', …)`, so behind a proxy that rewrites the peer address
 * (Render, for example) every request looks like it came from the proxy and the
 * ceiling becomes global instead of per-source. In that setup keep the default
 * generous, or raise `RATE_LIMIT_WEBHOOK_MAX` to cover the deliveries of every
 * repository the deployment serves.
 *
 * Raise `RATE_LIMIT_WEBHOOK_MAX` if a very high-traffic installation ever
 * legitimately exceeds it — GitHub retries failed deliveries, so a limit that
 * is too low costs data, while a limit that is somewhat higher only widens the
 * abuse window for a route that already requires a valid HMAC signature.
 *
 * **Ordering matters.** On the route, signature verification runs *before* this
 * middleware (`app.ts`), so unsigned or badly signed requests are rejected with
 * 401 and never increment the rate-limit counter. An attacker therefore cannot
 * spend the legitimate quota that a real GitHub delivery needs.
 *
 * **Behavior:**
 * - Applied only to `POST /api/webhooks/github`
 * - Runs after `createGitHubWebhookSignatureMiddleware()` on that route
 * - Disabled only when `NODE_ENV=test` **and** `RATE_LIMIT_TEST_BYPASS=true` (#1465)
 * - Returns standard `RateLimit-*` draft-8 headers on all responses
 * - Returns 429 with a `Retry-After` header when the ceiling is exceeded
 *
 * **Concurrency:** Thread-safe via express-rate-limit's in-process store; the
 * counter is per worker process.
 */
export const webhookLimiter: RequestHandler = createRateLimiter({ limit: WEBHOOK_MAX });

/**
 * @deprecated Use {@link mutationLimiter}. Retained for backward compatibility.
 *
 * Alias for {@link mutationLimiter}. Prefer the newer name in new code.
 */
export const limiter: RequestHandler = mutationLimiter;

/**
 * Validates whether a string is a valid Stellar Ed25519 public key.
 *
 * Checks the key format and CRC-16 checksum using `StrKey.isValidEd25519PublicKey()`
 * from `@stellar/stellar-sdk`. A valid key starts with 'G', is 56 characters total,
 * and has a valid checksum.
 *
 * **Synchronous, no I/O.** Never throws. Always returns a boolean.
 *
 * @param address - A string to validate as a Stellar public key.
 * @returns `true` if `address` is a valid Ed25519 public key (G-address format),
 *          `false` otherwise.
 *
 * @example
 * ```ts
 * isValidStellarAddress('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF') // => true
 * isValidStellarAddress('not-a-key') // => false
 * ```
 *
 * **Concurrency:** Stateless, no side effects. Safe to call concurrently.
 */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}

/**
 * Builds a map of Stellar token symbols to their Soroban contract addresses.
 *
 * Merges multiple sources in priority order:
 * 1. Built-in defaults: `XLM` and `USDC` (always present unless overridden)
 * 2. `TOKEN_ADDRESS_MAP` environment variable (JSON object, if valid)
 * 3. `TOKEN_ADDR_<SYMBOL>` and `TOKEN_ADDRESS_<SYMBOL>` environment variables
 *
 * Keys in the returned map are always upper-cased. Later sources override earlier ones.
 * A malformed `TOKEN_ADDRESS_MAP` JSON is logged with `console.warn()` and ignored.
 *
 * **Synchronous, no I/O.** Never throws, even for malformed env values.
 *
 * @returns A new `Record<string, string>` mapping upper-case token symbols to their
 *          contract addresses. Built-in symbols `XLM` and `USDC` are always included
 *          unless explicitly overridden by environment variables.
 *
 * @example
 * ```ts
 * // With defaults only:
 * getTokenAddressMap()
 * // => { XLM: 'CAS3J7...', USDC: 'CCW677...' }
 *
 * // With TOKEN_ADDRESS_MAP env var:
 * process.env.TOKEN_ADDRESS_MAP = '{"EURC":"CC..."}';
 * getTokenAddressMap()
 * // => { XLM: 'CAS3J7...', USDC: 'CCW677...', EURC: 'CC...' }
 *
 * // With TOKEN_ADDR_* env var:
 * process.env.TOKEN_ADDR_STELLAR = 'C...';
 * getTokenAddressMap()
 * // => { XLM: 'CAS3J7...', USDC: 'CCW677...', STELLAR: 'C...' }
 * ```
 *
 * **Concurrency:** Reads `process.env` fresh on every call (not cached).
 * Safe to call concurrently. Returns a new map object each time, so mutations
 * by the caller do not affect future calls. If environment variables are mutated
 * while the process runs (e.g., in tests), successive calls reflect those changes.
 */
export function getTokenAddressMap(): Record<string, string> {
  const map: Record<string, string> = {
    XLM: 'CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA',
    USDC: 'CCW677VKUVRVH25WJ3G7L2NKV6AEFBSFW4FG7L0XXXXXX',
  };

  const mapStr = process.env.TOKEN_ADDRESS_MAP;
  if (mapStr) {
    try {
      const parsed = JSON.parse(mapStr);
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') {
          map[k.toUpperCase()] = v;
        }
      }
    } catch (err) {
      console.warn("Failed to parse TOKEN_ADDRESS_MAP env variable as JSON", err);
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (value && (key.startsWith('TOKEN_ADDR_') || key.startsWith('TOKEN_ADDRESS_'))) {
      const symbol = key.replace(/^(TOKEN_ADDR_|TOKEN_ADDRESS_)/, '').toUpperCase();
      map[symbol] = value;
    }
  }

  return map;
}

/**
 * Resolves a token symbol to its Soroban contract address.
 *
 * Looks up the symbol (case-insensitive, trimmed) in the token address map built by
 * {@link getTokenAddressMap}. Throws if the symbol is not found.
 *
 * **Synchronous, no I/O.** Never returns `null` or `undefined`.
 *
 * @param symbol - A token symbol (e.g., "XLM", "USDC", "EURC").
 *                 Case and whitespace are normalized before lookup.
 * @returns The Soroban contract address string for the given symbol.
 *
 * @throws {Error} If the symbol is not found in the token address map.
 *         Error message: `Token symbol "<symbol>" cannot be resolved to a token address.`
 *
 * @example
 * ```ts
 * resolveTokenAddress('XLM')  // => 'CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA'
 * resolveTokenAddress('USDC') // => 'CCW677VKUVRVH25WJ3G7L2NKV6AEFBSFW4FG7L0XXXXXX'
 * resolveTokenAddress('UNKNOWN') // throws Error
 * ```
 *
 * **Concurrency:** Stateless. Calls {@link getTokenAddressMap} fresh on each invocation.
 * Safe to call concurrently.
 */
export function resolveTokenAddress(symbol: string): string {
  const map = getTokenAddressMap();
  const normalized = symbol.trim().toUpperCase();
  const address = map[normalized];
  if (!address) {
    throw new Error(`Token symbol "${symbol}" cannot be resolved to a token address.`);
  }
  return address;
}
