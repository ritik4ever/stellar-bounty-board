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

/** Global read limit (GET only): generous, protects against scraping. */
export const readLimiter: RequestHandler = makeLimiter(READ_MAX, { getOnly: true });

/** Strict limit for state-changing mutation routes. */
export const mutationLimiter: RequestHandler = makeLimiter(MUTATION_MAX);

/** @deprecated Use {@link mutationLimiter}. Retained for backward compatibility. */
export const limiter: RequestHandler = mutationLimiter;

export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}

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

export function resolveTokenAddress(symbol: string): string {
  const map = getTokenAddressMap();
  const normalized = symbol.trim().toUpperCase();
  const address = map[normalized];
  if (!address) {
    throw new Error(`Token symbol "${symbol}" cannot be resolved to a token address.`);
  }
  return address;
}
