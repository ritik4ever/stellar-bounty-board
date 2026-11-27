import bcrypt from "bcryptjs";
import type { RequestHandler } from "express";
import { MiddlewareDependencyError } from "./errors";

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
 * Skipped entirely (calls `next()`) when `NODE_ENV === "test"`.
 *
 * Responds with:
 *  - 500 if `ADMIN_API_KEY_HASH` is not configured on the server.
 *  - 401 if the header is missing or the key does not match the hash.
 *
 * Never throws. If `bcrypt.compare()` rejects (e.g. a malformed stored hash),
 * it calls `next()` with a {@link MiddlewareDependencyError} (operation
 * `admin_api_key.compare`, status 500); the terminal error handler renders it.
 *
 * Concurrency: stateless; `ADMIN_API_KEY_HASH` is read on every request, so
 * rotating it takes effect without a restart.
 *
 * @returns An async Express middleware.
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
    } catch (err) {
      // A malformed stored hash or bcrypt failure is a server fault; keep the
      // cause for the logs and send the client a fixed message.
      next(
        new MiddlewareDependencyError({
          operation: "admin_api_key.compare",
          dependency: "bcrypt",
          statusCode: 500,
          publicMessage: "Failed to verify admin API key.",
          cause: err,
        }),
      );
      return;
    }

    if (!match) {
      res.status(401).json({ error: "Invalid admin API key." });
      return;
    }

    next();
  };
}
