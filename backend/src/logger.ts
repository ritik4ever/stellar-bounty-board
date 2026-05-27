import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/** Regex matching Stellar secret keys (start with S, followed by 55 alphanumeric chars). */
const STELLAR_SECRET_KEY_RE = /^S[0-9A-Z]{55}$/;

/**
 * Recursively scan a log object and redact any string values that match the
 * Stellar secret-key pattern.  Returns a new object so the original is not
 * mutated.
 */
function redactStellarKeys(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && STELLAR_SECRET_KEY_RE.test(value)) {
      result[key] = "[redacted]";
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = redactStellarKeys(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = (value as unknown[]).map((item) =>
        typeof item === "string" && STELLAR_SECRET_KEY_RE.test(item)
          ? "[redacted]"
          : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Pino logger instance.
 *
 * - Development: pretty-printed, human-readable output via pino-pretty.
 * - Production:  single-line JSON, ready for log aggregators.
 *
 * Sensitive fields (Authorization, cookie, password, secret, token, api_key,
 * secretKey, privateKey, seed) are redacted at the serializer level.  In
 * addition, any string value that looks like a Stellar secret key
 * (`S` + 55 uppercase alphanumeric chars) is redacted regardless of its key
 * name via the `formatters.log` hook.
 */
export const logger = pino(
  {
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
    formatters: {
      log(obj) {
        return redactStellarKeys(obj);
      },
    },
  },
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
