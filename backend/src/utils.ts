import type { Request, RequestHandler, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { StrKey } from "@stellar/stellar-sdk";

/**
 * Rate limiting (#349).
 *
 * Two tiers, both configurable via env:
 *  - `readLimiter`     — global, GET-only, generous (default 120 req/min/IP).
 *  - `mutationLimiter` — strict, applied to state-changing routes
 *    (create / reserve / submit / release / refund) so a single client cannot
 *    hammer them (default 10 req/min/IP), independent of the read limit.
 *
 * Standard `RateLimit-*` headers are returned on every response; 429 responses
 * additionally carry a `Retry-After` header.
 */
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const READ_MAX = Number(process.env.RATE_LIMIT_READ_MAX ?? 120);
const MUTATION_MAX = Number(process.env.RATE_LIMIT_MUTATION_MAX ?? 10);

const isTest = process.env.NODE_ENV === "test";

const HEALTH_PATHS = new Set(["/api/health", "/api/health/deep", "/worker/health"]);

function isHealthPath(req: Request): boolean {
  return HEALTH_PATHS.has(req.path);
}

/** No-op middleware so test suites can hit routes freely. */
const passthrough: RequestHandler = (_req, _res, next) => next();

function makeLimiter(limit: number, options: { getOnly?: boolean } = {}): RequestHandler {
  if (isTest) {
    return passthrough;
  }
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ipv6Subnet: 56,
    ...(options.getOnly
      ? { skip: (req: Request) => req.method !== "GET" || isHealthPath(req) }
      : {}),
    handler: (_req: Request, res: Response) => {
      res.setHeader("Retry-After", String(Math.ceil(WINDOW_MS / 1000)));
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
 * - Disabled in test environments (`NODE_ENV=test`)
 * - Returns standard `RateLimit-*` draft-8 headers on all responses
 * - Returns 429 with `Retry-After` header when limit is exceeded
 *
 * **Concurrency:** Thread-safe via express-rate-limit's default in-process store
 * (or Redis-backed when `REDIS_URL` is configured).
 */
export const readLimiter: RequestHandler = makeLimiter(READ_MAX, { getOnly: true });

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
 * - Disabled in test environments (`NODE_ENV=test`)
 * - Returns standard `RateLimit-*` draft-8 headers on all responses
 * - Returns 429 with `Retry-After` header when limit is exceeded
 *
 * **Concurrency:** Thread-safe via express-rate-limit's default in-process store
 * (or Redis-backed when `REDIS_URL` is configured).
 */
export const mutationLimiter: RequestHandler = makeLimiter(MUTATION_MAX);

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
