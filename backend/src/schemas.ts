/**
 * schemas.ts
 *
 * Zod validation schemas for the bounty API.
 * Sanitization is applied as a Zod .transform() so it runs automatically
 * after type-checking and before the value reaches route logic or storage.
 *
 * Drop-in: replace the existing createBountySchema (or equivalent) in your
 * routes/bounties.ts with the export from this file.
 */

import { z } from "zod";
import { sanitizeText } from "./sanitize";

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
});

export type CreateBountyInput = z.infer<typeof createBountySchema>;