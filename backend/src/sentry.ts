import * as Sentry from "@sentry/node";
import type { Request, Response, NextFunction } from "express";
import type { ErrorEvent, EventHint, Breadcrumb } from "@sentry/core";
import { redactStellarSecrets } from "./logger";

// ── Sensitive field patterns ─────────────────────────────────────────────────
// Fields matching these names are scrubbed from Sentry event payloads.

const SENSITIVE_FIELD_PATTERNS = [
  /authorization/i,
  /cookie/i,
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /seed/i,
  /webhook[_-]?secret/i,
];

// Regex to match wallet-address-like strings (Stellar G... public keys, ETH 0x...)
const WALLET_ADDRESS_PATTERN = /G[A-Z0-9]{55}/g;
const ETH_ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/g;

// ── Before-send redaction ────────────────────────────────────────────────────

/**
 * Scrub sensitive data from a Sentry event before it is sent to the Sentry
 * ingestion endpoint.  This runs client-side so that API keys, wallet
 * addresses, and secret seeds never leave the process.
 *
 * Redaction layers:
 *  1. Sentry's built-in `denyUrls` / `sendDefaultPii: false` blocks some PII.
 *  2. `beforeSend` recursively walks every string in the event and:
 *       a. Replaces Stellar secret keys via the existing `redactStellarSecrets`.
 *       b. Replaces Stellar public-key / ETH-address patterns.
 *       c. Censors fields whose *names* match the sensitive-field list.
 */
export function redactBeforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  // Never send health-check noise
  const url = event.request?.url ?? "";
  if (url.includes("/api/health") || url.includes("/worker/health")) {
    return null;
  }

  // Scrub request headers of sensitive values
  if (event.request?.headers) {
    for (const [key, value] of Object.entries(event.request.headers)) {
      if (
        SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key)) &&
        typeof value === "string"
      ) {
        (event.request.headers as Record<string, string>)[key] =
          "[redacted]";
      }
    }
  }

  // Scrub request data (body, query string)
  if (event.request?.data && typeof event.request.data === "object") {
    event.request.data = redactSensitiveFields(
      event.request.data as Record<string, unknown>,
    ) as Record<string, unknown>;
  }

  if (
    event.request?.query_string &&
    typeof event.request.query_string === "string"
  ) {
    event.request.query_string = "[redacted]";
  }

  // Scrub extra data
  if (event.extra) {
    for (const [key, value] of Object.entries(event.extra)) {
      if (SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
        event.extra[key] = "[redacted]";
      }
    }
  }

  // Scrub exception values
  if (event.exception?.values) {
    for (const exc of event.exception.values) {
      if (exc.value && typeof exc.value === "string") {
        exc.value = redactSensitiveString(exc.value);
      }
      if (exc.stacktrace?.frames) {
        for (const frame of exc.stacktrace.frames) {
          if (frame.vars && typeof frame.vars === "object") {
            frame.vars = redactSensitiveFields(
              frame.vars as Record<string, unknown>,
            );
          }
        }
      }
    }
  }

  // Scrub breadcrumbs
  if (event.breadcrumbs) {
    const crumbs: Breadcrumb[] = Array.isArray(event.breadcrumbs)
      ? event.breadcrumbs
      : [];
    for (const crumb of crumbs) {
      if (crumb.data && typeof crumb.data === "object") {
        crumb.data = redactSensitiveFields(
          crumb.data as Record<string, unknown>,
        );
      }
    }
  }

  // Scrub any remaining top-level string fields
  if (event.message && typeof event.message === "string") {
    event.message = redactSensitiveString(event.message);
  }

  return event;
}

/** Recursively replace sensitive values in a plain object. */
function redactSensitiveFields(
  obj: Record<string, unknown>,
  seen = new WeakSet<object>(),
): Record<string, unknown> {
  if (obj && typeof obj === "object") {
    if (seen.has(obj)) return obj;
    seen.add(obj);
  }

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const isSensitiveField = SENSITIVE_FIELD_PATTERNS.some((p) =>
      p.test(key),
    );

    if (isSensitiveField) {
      out[key] = "[redacted]";
    } else if (typeof value === "string") {
      out[key] = redactSensitiveString(value);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        typeof item === "string"
          ? redactSensitiveString(item)
          : typeof item === "object" && item !== null
            ? redactSensitiveFields(item as Record<string, unknown>, seen)
            : item,
      );
    } else if (value && typeof value === "object") {
      out[key] = redactSensitiveFields(
        value as Record<string, unknown>,
        seen,
      );
    } else {
      out[key] = value;
    }
  }

  return out;
}

/** Scrub a single string of any embedded sensitive data. */
function redactSensitiveString(value: string): string {
  let result = redactStellarSecrets(value) as string;
  result = result.replace(WALLET_ADDRESS_PATTERN, "[redacted-wallet-address]");
  result = result.replace(ETH_ADDRESS_PATTERN, "[redacted-eth-address]");
  return result;
}

// ── Initialization ───────────────────────────────────────────────────────────

let initialized = false;

/**
 * Initialize the Sentry SDK.  Call once, as early as possible in the
 * application lifecycle (before any imports that could throw).
 *
 * When `SENTRY_DSN` is not set, Sentry is silently disabled — this avoids
 * errors in development and local testing.
 */
export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const environment =
    process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
  const release = process.env.SENTRY_RELEASE ?? process.env.npm_package_version;

  Sentry.init({
    dsn,
    environment,
    release,
    // Sample rate for performance transactions (0.0 – 1.0)
    tracesSampleRate: environment === "production" ? 0.2 : 1.0,
    // Sample rate for session tracking
    profilesSampleRate: environment === "production" ? 0.1 : 1.0,
    sendDefaultPii: false,
    beforeSend: redactBeforeSend,
  });

  // Global unhandled-exception / unhandled-rejection handlers.
  // Node's default listeners are removed so Sentry becomes the primary
  // handler while still allowing the process to exit gracefully.
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");

  process.on("uncaughtException", (error: Error) => {
    Sentry.captureException(error, { level: "fatal" });
    // Flush before exit so the event is delivered
    Sentry.flush(2000).finally(() => {
      process.exit(1);
    });
  });

  process.on("unhandledRejection", (reason: unknown) => {
    const error =
      reason instanceof Error
        ? reason
        : new Error(String(reason));
    Sentry.captureException(error, { level: "error" });
  });

  initialized = true;
}

// ── Express middleware ────────────────────────────────────────────────────────

/**
 * Express request handler — must be mounted **after** `express.json()` so
 * that `req.body` is available for context tagging.
 */
export function sentryRequestHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  Sentry.withScope((scope) => {
    // Tag the event with request context for triage
    scope.setTag("route", req.route?.path ?? req.path);
    scope.setTag("method", req.method);
    scope.setTag("requestId", req.requestId ?? "unknown");

    if (req.requestId) {
      scope.addEventProcessor((event) => {
        event.request = {
          ...event.request,
          method: req.method,
          url: `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`,
          headers: {
            "user-agent": req.get("user-agent") ?? "unknown",
            "x-request-id": req.requestId,
          } as Record<string, string>,
        };
        return event;
      });
    }
  });

  next();
}

/**
 * Express error handler — must be mounted **after** all routes.
 * Captures the error into Sentry and then delegates to the next error handler
 * (or sends a 500 response if nothing else handles it).
 */
export function sentryErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("route", req.route?.path ?? req.path);
    scope.setTag("method", req.method);
    scope.setTag("requestId", req.requestId ?? "unknown");
    scope.addEventProcessor((event) => {
      event.request = {
        ...event.request,
        method: req.method,
        url: `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`,
        headers: {
          "user-agent": req.get("user-agent") ?? "unknown",
          "x-request-id": req.requestId,
        } as Record<string, string>,
      };
      return event;
    });
  });

  Sentry.captureException(err);

  // If there is no downstream error handler, send a 500.
  // Otherwise delegate to the next error handler.
  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Internal server error",
    requestId: req.requestId,
  });
}

// ── Manual capture helpers ───────────────────────────────────────────────────

/**
 * Capture an exception with request context already applied to the Sentry
 * scope.  Useful for catching errors in async code outside of Express
 * middleware (e.g. background jobs, worker threads).
 */
export function captureErrorException(
  error: Error,
  context?: {
    requestId?: string;
    route?: string;
    [key: string]: unknown;
  },
): string {
  Sentry.withScope((scope) => {
    if (context?.requestId) {
      scope.setTag("requestId", context.requestId);
    }
    if (context?.route) {
      scope.setTag("route", context.route);
    }
    // Set any additional context as extras (will be scrubbed by beforeSend)
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        if (key !== "requestId" && key !== "route") {
          scope.setExtra(key, value);
        }
      }
    }
  });
  return Sentry.captureException(error);
}
