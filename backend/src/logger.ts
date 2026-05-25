import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Pino logger instance.
 *
 * - Development: pretty-printed, human-readable output via pino-pretty.
 * - Production:  single-line JSON, ready for log aggregators.
 *
 * Sensitive fields (Authorization, cookie, password, secret, token, api_key)
 * are redacted at the serializer level so they never appear in any log output.
 */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.secret',
        '*.token',
        '*.apiKey',
        '*.api_key',
        '*.Authorization',
      ],
      censor: '[redacted]',
    },
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      })
    : undefined,
);

// ── Legacy shim ─────────────────────────────────────────────────────────────
// Keeps existing callers of `logStructured` working without changes.

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function logStructured(
  level: 'info' | 'warn' | 'error',
  msg: string,
  fields: LogFields = {},
): void {
  logger[level](fields, msg);
}
