import type { CorsOptions } from "cors";
import type { RequestHandler } from "express";

/** `production` when `NODE_ENV=production`, otherwise `development` (includes test). */
export type CorsMode = "production" | "development";

/** Resolved CORS policy, as returned by {@link resolveCorsConfig}. */
export interface CorsConfig {
  mode: CorsMode;
  /** `null` means permissive — reflect any browser origin (dev wildcard). */
  allowlist: Set<string> | null;
}

const CORS_DENIED_MESSAGE = "Origin not allowed by CORS policy.";

/**
 * Parse a comma-separated origin list into a set of trimmed origin strings.
 *
 * Empty entries are dropped, so `""` and `" , "` return an empty set. Origins
 * are not validated or normalised: `https://a.com/` and `https://a.com` are
 * different entries. `"*"` is kept as a literal entry; wildcard handling is up
 * to {@link resolveCorsConfig}.
 *
 * @param raw - Comma-separated origins, e.g. `"https://a.com, https://b.com"`.
 * @returns A new set; never throws.
 */
export function parseOriginAllowlist(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function isWildcardOriginConfig(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed === "" || trimmed === "*";
}

/**
 * Resolve CORS configuration from environment.
 *
 * Production (`NODE_ENV=production`):
 *   - Uses `ALLOWED_ORIGINS` only (strict allowlist; empty set if unset).
 *
 * Development / test:
 *   - Uses `CORS_ORIGINS`, then `ALLOWED_ORIGINS`, then defaults to `*` (permissive).
 *   - An empty or `*` value gives `allowlist: null` (permissive).
 *
 * Reads the environment on every call, and so does every consumer below that
 * does not take a config argument. Never throws.
 *
 * @returns A fresh config object. In production `allowlist` is always a set,
 *   possibly empty; it is never `null`.
 */
export function resolveCorsConfig(): CorsConfig {
  if (process.env.NODE_ENV === "production") {
    const raw = process.env.ALLOWED_ORIGINS ?? "";
    return {
      mode: "production",
      allowlist: parseOriginAllowlist(raw),
    };
  }

  const raw = process.env.CORS_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? "*";
  if (isWildcardOriginConfig(raw)) {
    return {
      mode: "development",
      allowlist: null,
    };
  }

  return {
    mode: "development",
    allowlist: parseOriginAllowlist(raw),
  };
}

/**
 * Whether a browser origin may access the API.
 *
 * A missing origin (same-origin requests, curl, server-to-server) is always
 * allowed. With a permissive config (`allowlist: null`) every origin is
 * allowed. Otherwise the origin must match an allowlist entry exactly.
 *
 * @param origin - Value of the request's `Origin` header, if any.
 * @param config - Policy to check against; defaults to a fresh
 *   {@link resolveCorsConfig} read from the environment.
 * @returns `true` if allowed. Never throws.
 */
export function isOriginAllowed(
  origin: string | undefined,
  config: CorsConfig = resolveCorsConfig(),
): boolean {
  if (!origin) {
    return true;
  }

  if (config.allowlist === null) {
    return true;
  }

  return config.allowlist.has(origin);
}

/**
 * Warn when production is configured without an explicit frontend allowlist.
 *
 * Writes one `console.warn` line when `NODE_ENV=production` and
 * `ALLOWED_ORIGINS` is unset or blank; otherwise does nothing. Intended to
 * run once at startup. Never throws, and does not stop startup.
 */
export function warnIfProductionCorsMisconfigured(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) {
    console.warn(
      "[cors] NODE_ENV=production but ALLOWED_ORIGINS is unset; browser origins will be rejected.",
    );
  }
}

/**
 * Reject disallowed production preflight requests with HTTP 403 before the cors
 * middleware runs.
 *
 * Only acts when `NODE_ENV=production`, the method is `OPTIONS`, and an
 * `Origin` header is present. It then responds 403
 * `{ error: "Origin not allowed by CORS policy." }` if the origin is not in
 * `ALLOWED_ORIGINS`. Everything else calls `next()`. Non-preflight requests
 * from disallowed origins are not blocked here; the `cors` middleware omits
 * their CORS headers and the browser rejects them.
 *
 * The config is re-read from the environment on every request. Never throws.
 *
 * @returns A synchronous Express middleware.
 */
export function createCorsPreflightGuard(): RequestHandler {
  return (req, res, next) => {
    const config = resolveCorsConfig();

    if (config.mode !== "production") {
      next();
      return;
    }

    if (req.method !== "OPTIONS") {
      next();
      return;
    }

    const origin = req.headers.origin;
    if (!origin || typeof origin !== "string") {
      next();
      return;
    }

    if (!config.allowlist?.has(origin)) {
      res.status(403).json({ error: CORS_DENIED_MESSAGE });
      return;
    }

    next();
  };
}

/**
 * Build a CORS options object for the express `cors` middleware.
 *
 * Production uses `ALLOWED_ORIGINS`. Development defaults to permissive `*`
 * behavior (dynamic origin reflection) when unset.
 *
 * The config is resolved **once**, when this is called. Environment changes
 * after that are not picked up (unlike {@link createCorsPreflightGuard}).
 * Disallowed origins get `callback(null, false)`, which omits the CORS headers
 * instead of raising an error, so the request itself still reaches the route.
 * Credentials are enabled. Never throws.
 *
 * @returns Options for `cors()`.
 */
export function buildCorsOptions(): CorsOptions {
  const config = resolveCorsConfig();

  return {
    origin(requestOrigin, callback) {
      if (!requestOrigin) {
        callback(null, true);
        return;
      }

      if (isOriginAllowed(requestOrigin, config)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-Hub-Signature-256",
      "X-Stellar-Signature",
      "X-Stellar-Public-Key",
      "Idempotency-Key",
    ],
    credentials: true,
  };
}
