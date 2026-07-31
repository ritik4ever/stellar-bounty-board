import type { CorsOptions } from "cors";
import type { RequestHandler } from "express";

export type CorsMode = "production" | "development";

export interface CorsConfig {
  mode: CorsMode;
  /** `null` means permissive — reflect any browser origin (dev wildcard). */
  allowlist: Set<string> | null;
}

const CORS_DENIED_MESSAGE = "Origin not allowed by CORS policy.";

/**
 * Parse a comma-separated origin list into a set of trimmed origin strings.
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
