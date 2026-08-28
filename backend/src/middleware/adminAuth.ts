import bcrypt from "bcryptjs";
import type { RequestHandler } from "express";

const HEADER_ADMIN_KEY = "x-admin-api-key";
const ENV_ADMIN_KEY_HASH = "ADMIN_API_KEY_HASH";
const ENV_ADMIN_KEY_HASH_READONLY = "ADMIN_API_KEY_HASH_READONLY";

/**
 * The scope controls which API key(s) are accepted for a given route.
 *
 *  - `"admin-write"` (default): only the full admin key (`ADMIN_API_KEY_HASH`)
 *    is accepted. Use this scope on routes that mutate bounty state or expose
 *    sensitive write operations.
 *
 *  - `"read-only"`: the read-only key (`ADMIN_API_KEY_HASH_READONLY`) **or**
 *    the full admin key (`ADMIN_API_KEY_HASH`) are accepted. Use this scope on
 *    dashboard / reporting endpoints that only read data. A full admin key
 *    can always access read-only routes so that single-key deployments continue
 *    to work without any configuration changes.
 *
 * Backward-compatibility guarantee
 * ---------------------------------
 * Existing deployments that only configure `ADMIN_API_KEY_HASH` continue to
 * work: the `"admin-write"` scope behaves identically to the original
 * middleware, and read-only routes also accept the full admin key when no
 * separate read-only key has been provisioned.
 */
export type ApiKeyScope = "read-only" | "admin-write";

/**
 * Express middleware that authenticates admin requests using a bcrypt-hashed
 * API key.
 *
 * The operator stores the bcrypt hash of the full admin key in
 * `ADMIN_API_KEY_HASH` (generated once via `scripts/hash-admin-key.js`).
 * Optionally, a separate read-only key hash may be stored in
 * `ADMIN_API_KEY_HASH_READONLY` to allow dashboard/reporting integrations
 * limited access without write privileges.
 *
 * Incoming requests must supply the raw key in the `x-admin-api-key` header;
 * the middleware compares it with `bcrypt.compare()` so the plaintext key is
 * never stored or logged.
 *
 * Responds with:
 *  - 500 if the required hash env var(s) are not configured on the server.
 *  - 401 if the header is missing or the key does not match any accepted hash.
 *
 * @param scope - Controls which keys are accepted (default: `"admin-write"`).
 */
export function createAdminApiKeyAuthMiddleware(
  scope: ApiKeyScope = "admin-write"
): RequestHandler {
  return async (req, res, next) => {
    // Skip auth in test environment so integration tests don't need a hash.
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }

    const adminHash = process.env[ENV_ADMIN_KEY_HASH];

    if (!adminHash) {
      res
        .status(500)
        .json({ error: "Admin API key is not configured on this server." });
      return;
    }

    const incomingKey = req.header(HEADER_ADMIN_KEY);
    if (!incomingKey) {
      res.status(401).json({ error: `Missing ${HEADER_ADMIN_KEY} header.` });
      return;
    }

    // For read-only scope, also accept a separately provisioned read-only key.
    // Try the read-only hash first (cheaper fast path when both keys exist),
    // then fall back to the full admin hash so single-key deployments work.
    if (scope === "read-only") {
      const readonlyHash = process.env[ENV_ADMIN_KEY_HASH_READONLY];

      if (readonlyHash) {
        let readonlyMatch: boolean;
        try {
          readonlyMatch = await bcrypt.compare(incomingKey, readonlyHash);
        } catch {
          res.status(500).json({ error: "Failed to verify admin API key." });
          return;
        }

        if (readonlyMatch) {
          next();
          return;
        }
      }

      // Fall through to check the full admin key — a full admin key always
      // has access to read-only routes.
    }

    // Verify against the full admin key hash (required for admin-write scope;
    // also the fallback for read-only scope when no dedicated read-only key
    // is configured or when the read-only key check failed above).
    let adminMatch: boolean;
    try {
      adminMatch = await bcrypt.compare(incomingKey, adminHash);
    } catch {
      res.status(500).json({ error: "Failed to verify admin API key." });
      return;
    }

    if (!adminMatch) {
      res.status(401).json({ error: "Invalid admin API key." });
      return;
    }

    next();
  };
}
