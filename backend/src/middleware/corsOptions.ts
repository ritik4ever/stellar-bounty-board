import type { CorsOptions } from 'cors';

/**
 * Build a CORS options object from the `CORS_ORIGINS` environment variable.
 *
 * `CORS_ORIGINS` should be a comma-separated list of allowed origins, e.g.:
 *   CORS_ORIGINS=https://app.example.com,https://staging.example.com
 *
 * When the variable is absent or empty the default origin is `http://localhost:3000`
 * so local development works without any configuration.
 *
 * Requests from origins NOT in the allowlist receive a CORS error (no
 * `Access-Control-Allow-Origin` header), which browsers treat as a 403-equivalent.
 */
export function buildCorsOptions(): CorsOptions {
  const raw = process.env.CORS_ORIGINS ?? '';
  const allowlist: Set<string> = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  if (allowlist.size === 0) {
    allowlist.add('http://localhost:3000');
  }

  return {
    origin(requestOrigin, callback) {
      // Non-browser requests (curl, server-to-server) have no Origin header.
      if (!requestOrigin) {
        callback(null, true);
        return;
      }

      if (allowlist.has(requestOrigin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin "${requestOrigin}" is not allowed by CORS policy.`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'X-Hub-Signature-256',
      'X-Stellar-Signature',
      'X-Stellar-Public-Key',
    ],
    credentials: true,
  };
}
