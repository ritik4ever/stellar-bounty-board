/**
 * schemas.ts
 *
 * Zod validation schemas for the bounty API.
 * Sanitization is applied as a Zod .transform() so it runs automatically
 * after type-checking and before the value reaches route logic or storage.
 *
 * Drop-in: replace the existing createBountySchema (or equivalent) in your
 * routes/bounties.ts with the export from this file.
 *
 * Note: the canonical schema used by the Express routes lives in
 * ./validation/schemas.ts, which includes OpenAPI annotations and a broader
 * set of request/response schemas.  This file is the simpler standalone
 * variant kept in sync with that canonical version for consumers that import
 * directly from src/schemas.
 */

import { z } from "zod";
import { sanitizeText } from "./sanitize";
import { getTokenAddressMap } from "./utils";

// ---------------------------------------------------------------------------
// Reusable sanitized string primitive
// ---------------------------------------------------------------------------

/**
 * A non-empty string that is trimmed and HTML-encoded before use.
 * Pass `maxLength` to override the default per-field cap.
 */
function sanitizedString(maxLength = 1000) {
  return z
    .string()
    .min(1, "Field must not be empty")
    .max(maxLength, `Field must be at most ${maxLength} characters`)
    .transform(sanitizeText);
}

// ---------------------------------------------------------------------------
// Token allowlist helpers
// ---------------------------------------------------------------------------

const TOKEN_REGEX = /^[A-Za-z0-9]{1,12}$/;

/**
 * Returns the set of allowed token symbols.
 *
 * Priority order:
 *  1. `ALLOWED_TOKEN_SYMBOLS` env var (comma-separated list).
 *  2. Keys of `TOKEN_ADDRESS_MAP` / `TOKEN_ADDR_*` env vars (via getTokenAddressMap).
 *  3. Built-in defaults: XLM and USDC.
 */
export function getAllowedTokenSymbols(): string[] {
  const configured = process.env.ALLOWED_TOKEN_SYMBOLS?.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  return Object.keys(getTokenAddressMap());
}

// ---------------------------------------------------------------------------
// Bounty creation schema
// ---------------------------------------------------------------------------

export const createBountySchema = z.object({
  /** GitHub issue URL the bounty is linked to */
  issueUrl: z.string().url("issueUrl must be a valid URL"),

  /** Short human-readable title — trimmed and HTML-encoded */
  title: sanitizedString(200),

  /** Longer description — trimmed and HTML-encoded */
  summary: sanitizedString(2000),

  /** Reward in XLM (string to avoid floating-point surprises) */
  reward: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, "reward must be a positive decimal number"),

  /** Optional urgency label */
  urgency: z.enum(["low", "medium", "high"]).optional(),

  /**
   * Token symbol for payout (e.g. XLM, USDC, or an approved custom SAC token).
   *
   * - Must be 1–12 alphanumeric characters.
   * - Normalised to uppercase before validation.
   * - Validated against the configured allowlist: set ALLOWED_TOKEN_SYMBOLS
   *   (comma-separated) to override the built-in XLM + USDC defaults, or add
   *   custom entries via TOKEN_ADDRESS_MAP / TOKEN_ADDR_<SYMBOL> env vars.
   */
  tokenSymbol: z
    .string()
    .trim()
    .regex(TOKEN_REGEX, "Token symbol must be 1–12 letters or numbers.")
    .transform((symbol) => symbol.toUpperCase())
    .superRefine((symbol, ctx) => {
      const allowed = getAllowedTokenSymbols();
      if (!allowed.includes(symbol)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unsupported token symbol. Allowed values: ${allowed.join(", ")}`,
        });
      }
    }),
});

export type CreateBountyInput = z.infer<typeof createBountySchema>;
