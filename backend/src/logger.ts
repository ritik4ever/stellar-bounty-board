import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Matches a Stellar secret seed (StrKey): `S` followed by 55 base32 chars.
 * Used to scrub secret keys that leak into free-form strings (error messages,
 * request bodies) where path-based redaction cannot reach them (#381).
 */
const STELLAR_SECRET_KEY = /S[0-9A-Z]{55}/g;
const SECRET_CENSOR = "[redacted-secret-key]";

/** Recursively replace any Stellar secret key found in strings/objects/arrays. */
export function redactStellarSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return value.replace(STELLAR_SECRET_KEY, SECRET_CENSOR);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactStellarSecrets(item, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value as object)) {
      return value;
    }
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactStellarSecrets(val, seen);
    }
    return out;
  }
  return value;
}

/**
 * Pino logger instance.
 *
 * - Development: pretty-printed, human-readable output via pino-pretty.
 * - Production:  single-line JSON, ready for log aggregators.
 *
 * Sensitive data is removed two ways:
 *  - Path redaction (`redact`) masks named fields such as Authorization,
 *    cookie, password, secret, token, api_key, and Stellar key fields
 *    (`secretKey` / `privateKey` / `seed`).
 *  - Value redaction (`hooks.logMethod`) scrubs any Stellar secret key
 *    (`S...`, 56 chars) that slips into a message string or nested object,
 *    even when the field name is not in the redact path list (#381).
 */
/** Base pino options (exported so tests can build an identical logger). */
export const baseLoggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.secret",
      "*.token",
      "*.apiKey",
      "*.api_key",
      "*.Authorization",
      "*.secretKey",
      "*.privateKey",
      "*.seed",
    ],
    censor: "[redacted]",
  },
  hooks: {
    logMethod(args, method) {
      // Scrub Stellar secret keys from every argument (merging object + msg)
      // before pino serializes them.
      const scrubbed = args.map((arg) => redactStellarSecrets(arg)) as typeof args;
      return method.apply(this, scrubbed);
    },
  },
};

export const logger = pino(
  baseLoggerOptions,
  isDev
    ? pino.transport({
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
      })
    : undefined,
);

// ── Legacy shim ─────────────────────────────────────────────────────────────
// Keeps existing callers of `logStructured` working without changes.

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function logStructured(
  level: "info" | "warn" | "error",
  msg: string,
  fields: LogFields = {},
): void {
  logger[level](fields, msg);
}
