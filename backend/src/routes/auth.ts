/**
 * SEP-10 authentication routes.
 *
 * GET  /api/auth/challenge?account=G...   — issue a SEP-10 challenge transaction
 * POST /api/auth/verify                  — verify a signed challenge and receive a JWT
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { buildChallenge, verifyChallenge } from "../services/sep10Auth";
import { logger } from "../logger";

export const authRouter = Router();

// ---------------------------------------------------------------------------
// Input validation schemas
// ---------------------------------------------------------------------------

const challengeQuerySchema = z.object({
  account: z
    .string({ required_error: "account query parameter is required." })
    .regex(/^[GM][A-Z2-7]{54,55}$/, "account must be a valid Stellar public key (G...) or muxed account (M...)."),
});

const verifyBodySchema = z.object({
  transaction: z
    .string({ required_error: "transaction is required." })
    .min(1, "transaction must not be empty."),
  account: z
    .string({ required_error: "account is required." })
    .regex(/^[GM][A-Z2-7]{54,55}$/, "account must be a valid Stellar public key (G...) or muxed account (M...)."),
});

// ---------------------------------------------------------------------------
// GET /api/auth/challenge
// ---------------------------------------------------------------------------

/**
 * Issues a SEP-10 challenge transaction for the given Stellar account.
 *
 * Query parameters:
 *   - account (required): Stellar public key G... or muxed account M... of the wallet
 *
 * Response 200:
 *   {
 *     "transaction": "<base64 XDR>",
 *     "network_passphrase": "<network passphrase>"
 *   }
 */
authRouter.get("/challenge", (req: Request, res: Response): void => {
  const parsed = challengeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.errors.map((e) => e.message).join("; "),
    });
    return;
  }

  try {
    const result = buildChallenge(parsed.data.account);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build challenge.";
    logger.error({ err }, "SEP-10 challenge build failed");
    res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify
// ---------------------------------------------------------------------------

/**
 * Verifies a signed SEP-10 challenge transaction and issues a JWT.
 *
 * Request body:
 *   {
 *     "transaction": "<base64 XDR of signed challenge>",
 *     "account": "G... or M... wallet address"
 *   }
 *
 * Response 200:
 *   {
 *     "token": "<JWT>",
 *     "account": "<Stellar public key>"
 *   }
 *
 * Error responses:
 *   400 — malformed request or invalid challenge structure
 *   401 — signature invalid, wrong signer, expired challenge, or replay
 */
authRouter.post("/verify", (req: Request, res: Response): void => {
  const parsed = verifyBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.errors.map((e) => e.message).join("; "),
    });
    return;
  }

  const { transaction, account } = parsed.data;

  try {
    const result = verifyChallenge(transaction, account);
    res.json({ token: result.token, account: result.accountId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Challenge verification failed.";
    logger.warn({ account, err: message }, "SEP-10 verify rejected");

    // Differentiate structural errors (400) from auth failures (401).
    const isStructural =
      message.includes("Invalid SEP-10 challenge") ||
      message.includes("Malformed");
    const statusCode = isStructural ? 400 : 401;

    res.status(statusCode).json({ error: message });
  }
});
