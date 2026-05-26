import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { StrKey } from "@stellar/stellar-sdk";

/** Bypass strict limits in automated tests so suites can hit POST routes freely. */
export const limiter: RequestHandler =
  process.env.NODE_ENV === "test"
    ? (_req, _res, next) => next()
    : rateLimit({
        windowMs: 1 * 60 * 1000,
        limit: 5,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        ipv6Subnet: 56,
      });

export const SOROBAN_ADDRESS_REGEX = /^C[A-Z2-7]{55}$/;

export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}
