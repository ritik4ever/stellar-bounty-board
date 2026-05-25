import pino, { type DestinationStream, type LoggerOptions } from "pino";

const isDev = process.env.NODE_ENV !== "production";
const REDACTED = "[redacted]";
const STELLAR_SECRET_KEY_PATTERN = /S[A-Z2-7]{55}/g;

function redactStellarSecretText(value: string): string {
  return value.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED);
}

function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return redactStellarSecretText(value);
  }

  if (value instanceof Error) {
    const redactedError = new Error(redactStellarSecretText(value.message));
    redactedError.name = value.name;
    redactedError.stack = value.stack ? redactStellarSecretText(value.stack) : value.stack;
    return redactedError;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return value;
    }

    seen.add(value);

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactLogValue(entry, seen)]),
    );
  }

  return value;
}

const loggerOptions: LoggerOptions = {
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
    censor: REDACTED,
  },
  hooks: {
    logMethod(args, method) {
      (method as (...methodArgs: unknown[]) => void).apply(
        this,
        args.map((arg) => redactLogValue(arg)),
      );
    },
  },
};

/**
 * Pino logger instance.
 *
 * - Development: pretty-printed, human-readable output via pino-pretty.
 * - Production:  single-line JSON, ready for log aggregators.
 *
 * Sensitive fields and Stellar secret keys are redacted before they reach
 * log output.
 */
export function createLogger(destination?: DestinationStream) {
  if (destination) {
    return pino(loggerOptions, destination);
  }

  return pino(
    loggerOptions,
    isDev
      ? pino.transport({
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
        })
      : undefined,
  );
}

export const logger = createLogger();

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
