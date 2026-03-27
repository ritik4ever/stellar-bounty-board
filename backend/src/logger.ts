export type LogFields = Record<string, string | number | boolean | null | undefined>;

const SENSITIVE_KEYS = new Set([
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
]);

/**
 * Single-line JSON logs for structured parsing. Omits undefined; never pass raw request bodies.
 */
export function logStructured(level: "info" | "warn" | "error", msg: string, fields: LogFields = {}): void {
  const safe: Record<string, string | number | boolean | null> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.has(lower) || lower.includes("password") || lower.includes("secret")) {
      safe[k] = "[redacted]";
      continue;
    }
    safe[k] = v as string | number | boolean | null;
  }
  const line = JSON.stringify(safe);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
