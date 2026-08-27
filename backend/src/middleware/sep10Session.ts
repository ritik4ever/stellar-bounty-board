/**
 * SEP-10 JWT session middleware.
 *
 * Validates the `Authorization: Bearer <jwt>` header issued by POST /api/auth/verify.
 * On success, attaches the authenticated Stellar address to `req.signerPublicKey`
 * so downstream handlers have a verified identity without trusting raw address claims
 * in the request body.
 *
 * Usage:
 *   import { requireSep10Auth } from "./middleware/sep10Session";
 *   app.post("/api/bounties/:id/release", requireSep10Auth(), ...);
 */

import type { RequestHandler } from "express";
import { verifyJwt } from "../services/sep10Auth";
import { logger } from "../logger";

/**
 * Returns a middleware that enforces a valid SEP-10 session JWT.
 *
 * In `NODE_ENV=test` the middleware is bypassed — `req.signerPublicKey` must
 * be set by the test itself if the handler needs it.  This mirrors the
 * behaviour of the legacy `createStellarSignatureAuthMiddleware`.
 */
export function requireSep10Auth(): RequestHandler {
  return (req, res, next) => {
    // Allow tests to skip real JWT verification.
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: "Missing Authorization header. Use Bearer <token>." });
      return;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      res.status(401).json({ error: "Invalid Authorization header format. Use: Bearer <token>." });
      return;
    }

    const token = parts[1];

    try {
      const payload = verifyJwt(token);
      // Attach the verified Stellar address for use by route handlers.
      req.signerPublicKey = payload.sub;
      logger.debug({ accountId: payload.sub }, "SEP-10 session verified");
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Token verification failed.";
      logger.warn({ err: message }, "SEP-10 session rejected");
      res.status(401).json({ error: message });
    }
  };
}
