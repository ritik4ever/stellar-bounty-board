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
    ...(options.getOnly ? { skip: (req: Request) => req.method !== "GET" } : {}),
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

/**
 * Format a token amount with Stellar-standard 7 decimal places.
 *
 * @param amount - The numeric amount to format
 * @param tokenSymbol - The token symbol to append (e.g. "XLM")
 * @returns Formatted string like "42.5000000 XLM"
 */
export function formatAmount(amount: number, tokenSymbol: string): string {
  return `${amount.toFixed(7)} ${tokenSymbol.toUpperCase()}`;
}

/**
 * Compute the deadline timestamp from a creation time and number of days.
 *
 * @param createdAt - Unix timestamp in seconds
 * @param deadlineDays - Number of days until deadline
 * @returns Unix timestamp in seconds representing the deadline
 */
export function computeDeadline(createdAt: number, deadlineDays: number): number {
  return createdAt + deadlineDays * 24 * 60 * 60;
}

/**
 * Check whether a bounty is expired at the given timestamp.
 *
 * A bounty is expired when the current time strictly exceeds the deadline
 * and the bounty status is "open" or "reserved".
 *
 * @param deadlineAt - Unix timestamp in seconds when the bounty expires
 * @param status - Current bounty status
 * @param now - Current Unix timestamp in seconds
 * @returns true if the bounty should be marked as expired
 */
export function isExpired(deadlineAt: number, status: string, now: number): boolean {
  return (status === "open" || status === "reserved") && now > deadlineAt;
}
