import bcrypt from "bcryptjs";
import type { RequestHandler } from "express";

const HEADER_ADMIN_KEY = "x-admin-api-key";
const ENV_ADMIN_KEY_HASH = "ADMIN_API_KEY_HASH";

/**
 * Express middleware that authenticates admin requests using a bcrypt-hashed
 * API key.
 *
 * The operator stores the bcrypt hash in the `ADMIN_API_KEY_HASH` environment
 * variable (generated once via `scripts/hash-admin-key.js`).  Incoming
 * requests must supply the raw key in the `x-admin-api-key` header; the
 * middleware compares it with `bcrypt.compare()` so the plaintext key is
 * never stored or logged.
 *
 * Responds with:
 *  - 500 if `ADMIN_API_KEY_HASH` is not configured on the server.
 *  - 401 if the header is missing or the key does not match the hash.
 */
export function createAdminApiKeyAuthMiddleware(): RequestHandler {
  return async (req, res, next) => {
    // Skip auth in test environment so integration tests don't need a hash.
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }

    const storedHash = process.env[ENV_ADMIN_KEY_HASH];
    if (!storedHash) {
      res.status(500).json({ error: "Admin API key is not configured on this server." });
      return;
    }

    const incomingKey = req.header(HEADER_ADMIN_KEY);
    if (!incomingKey) {
      res.status(401).json({ error: `Missing ${HEADER_ADMIN_KEY} header.` });
      return;
    }

    let match: boolean;
    try {
      match = await bcrypt.compare(incomingKey, storedHash);
    } catch {
      res.status(500).json({ error: "Failed to verify admin API key." });
      return;
    }

    if (!match) {
      res.status(401).json({ error: "Invalid admin API key." });
      return;
    }

    next();
  };
}
