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
/**
 * Pino's standard log levels, ordered by severity. `silent` disables output.
 * Custom levels are not supported here; operators choose from this set via the
 * `LOG_LEVEL` env var.
 */
export const VALID_LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
] as const;

export const DEFAULT_LOG_LEVEL = "info";

/**
 * Resolve the effective log level from `LOG_LEVEL`.
 *
 * - Unset → defaults to `info`.
 * - A recognized level (case-insensitive) → used as-is.
 * - Anything else → falls back to `info` and the rejected value is reported
 *   on `invalidValue` so the caller can emit a warning once the logger exists.
 *
 * Validating here (rather than passing the raw env var to pino) means an
 * operator typo like `LOG_LEVEL=verbose` degrades to sane output instead of
 * throwing at startup.
 */
export function resolveLogLevel(raw: string | undefined): {
  level: string;
  invalidValue?: string;
} {
  if (raw === undefined || raw === "") {
    return { level: DEFAULT_LOG_LEVEL };
  }
  const normalized = raw.trim().toLowerCase();
  if ((VALID_LOG_LEVELS as readonly string[]).includes(normalized)) {
    return { level: normalized };
  }
  return { level: DEFAULT_LOG_LEVEL, invalidValue: raw };
}

const resolvedLevel = resolveLogLevel(process.env.LOG_LEVEL);

/** Base pino options (exported so tests can build an identical logger). */
export const baseLoggerOptions: pino.LoggerOptions = {
  level: resolvedLevel.level,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-stellar-signature"]',
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

// Report an unusable LOG_LEVEL once the logger exists, so operators see why
// their configured verbosity was ignored (#257).
if (resolvedLevel.invalidValue !== undefined) {
  logger.warn(
    { invalidLogLevel: resolvedLevel.invalidValue, validLevels: VALID_LOG_LEVELS, fallback: DEFAULT_LOG_LEVEL },
    `Invalid LOG_LEVEL "${resolvedLevel.invalidValue}"; falling back to "${DEFAULT_LOG_LEVEL}"`,
  );
}

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
