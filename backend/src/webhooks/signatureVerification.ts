import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { logger } from "../logger";

type HmacAlgorithm = "sha1" | "sha256" | "sha512";
type SecretResolver = string | (() => string | undefined);

/**
 * Configuration for webhook signature verification.
 *
 * Specifies the HMAC algorithm, header name, signature prefix, and provider name.
 * Used by {@link verifyWebhookSignature} and middleware factories.
 */
export interface WebhookSignatureProfile {
  /** HMAC algorithm: "sha1" (legacy), "sha256" (preferred), or "sha512". */
  algorithm: HmacAlgorithm;
  /** HTTP request header name containing the signature (e.g., "x-hub-signature-256"). */
  headerName: string;
  /** Prefix of the signature value (e.g., "sha256="). */
  prefix: string;
  /** Human-readable provider name for error messages (e.g., "GitHub"). */
  providerName: string;
}

/**
 * Input to {@link verifyWebhookSignature}.
 *
 * Combines a {@link WebhookSignatureProfile} with the payload, secret, and incoming signature header.
 */
export interface VerifyWebhookSignatureInput extends WebhookSignatureProfile {
  /** The raw webhook payload (Buffer or string). */
  payload: Buffer | string;
  /** The HMAC secret configured for this webhook (may be undefined). */
  secret: string | undefined;
  /** The incoming signature header value (may be undefined, array, or string). */
  signatureHeader: string | string[] | undefined;
}

/**
 * Options for webhook signature middleware factories.
 *
 * Combines a {@link WebhookSignatureProfile} with a secret resolver (static string or callable).
 */
export interface WebhookSignatureMiddlewareOptions extends WebhookSignatureProfile {
  /** Secret resolver: either a static string or a callable that returns the secret. */
  secret: SecretResolver;
}

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

/**
 * Typed error for webhook signature verification failures.
 *
 * Carries an HTTP status code indicating whether the failure is a client error (401)
 * or server misconfiguration (500).
 *
 * **Thrown by:** {@link verifyWebhookSignature}, {@link verifyWithSecretRotation},
 * and signature middleware.
 *
 * **Handled by:** Middleware catches and returns JSON error response with the status code.
 *
 * **Concurrency:** Instances are created and thrown synchronously. Never thrown concurrently
 * for the same request (one thread per request).
 */
export class WebhookSignatureError extends Error {
  /**
   * Constructs a typed webhook signature error.
   *
   * @param message - Human-readable error message for the client.
   * @param statusCode - HTTP status code (401 for signature failures, 500 for config errors).
   */
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/**
 * Preferred GitHub webhook signature profile using HMAC-SHA256.
 *
 * **Header:** `X-Hub-Signature-256`
 * **Format:** `sha256=<hex-digest>`
 *
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads#delivery-headers
 */
export const githubWebhookSignatureProfile: WebhookSignatureProfile = {
  algorithm: "sha256",
  headerName: "x-hub-signature-256",
  prefix: "sha256=",
  providerName: "GitHub",
};

/**
 * Legacy GitHub webhook signature profile using HMAC-SHA1.
 *
 * **Header:** `X-Hub-Signature`
 * **Format:** `sha1=<hex-digest>`
 *
 * GitHub still sends this header for webhook configurations created before SHA-256 support was available.
 * Prefer {@link githubWebhookSignatureProfile} (SHA-256) for new webhook setups.
 *
 * When this profile is used, a warning is logged to encourage migration to SHA-256.
 *
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads#delivery-headers
 */
export const githubWebhookSignatureSha1Profile: WebhookSignatureProfile = {
  algorithm: "sha1",
  headerName: "x-hub-signature",
  prefix: "sha1=",
  providerName: "GitHub",
};

/**
 * Resolves a secret from a {@link SecretResolver}.
 *
 * If the resolver is a function, calls it and returns the result.
 * Otherwise returns the string directly.
 *
 * **Synchronous, no I/O.** Never throws.
 *
 * @param secret - A static string or callable that returns the secret.
 * @returns The resolved secret string, or `undefined` if the resolver returns `undefined`.
 *
 * @internal
 */
function resolveSecret(secret: SecretResolver): string | undefined {
  return typeof secret === "function" ? secret() : secret;
}

/**
 * Normalizes a signature header value to a single string.
 *
 * Express may deliver header values as a string or array of strings.
 * This helper takes the first element if an array, otherwise returns the value as-is.
 *
 * **Synchronous, no I/O.** Never throws.
 *
 * @param signatureHeader - The raw header value (string, array, or undefined).
 * @returns The first string if an array, the string if already a string, or `undefined`.
 *
 * @internal
 */
function normalizeSignature(signatureHeader: string | string[] | undefined): string | undefined {
  return Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
}

/**
 * Computes an HMAC signature for a webhook payload.
 *
 * Generates a signature string in the format `<prefix><hex-digest>` using the specified
 * algorithm and secret. This is the expected signature for verifying incoming webhooks.
 *
 * **Synchronous, no I/O.** Never throws unless the secret is `undefined`.
 *
 * @param payload - The webhook payload (Buffer or string).
 * @param secret - The HMAC secret. Must be defined.
 * @param algorithm - The HMAC algorithm ("sha1", "sha256", or "sha512").
 * @param prefix - The signature prefix (e.g., "sha256=").
 * @returns The complete signature string (e.g., "sha256=abc123...").
 *
 * @throws {WebhookSignatureError} If `secret` is undefined (500 status).
 *
 * **Concurrency:** Stateless. Safe to call concurrently.
 *
 * @example
 * ```ts
 * const sig = signWebhookPayload({
 *   payload: '{"action":"opened"}',
 *   secret: 'my-secret',
 *   algorithm: 'sha256',
 *   prefix: 'sha256='
 * });
 * // => 'sha256=abc123...'
 * ```
 */
export function signWebhookPayload({
  payload,
  secret,
  algorithm,
  prefix,
}: Pick<VerifyWebhookSignatureInput, "payload" | "secret" | "algorithm" | "prefix">): string {
  if (!secret) {
    throw new WebhookSignatureError("Webhook secret is not configured.", 500);
  }

  return `${prefix}${createHmac(algorithm, secret).update(payload).digest("hex")}`;
}

/**
 * Verifies a webhook signature using HMAC.
 *
 * Checks that the provided signature header matches the expected signature computed
 * from the payload and secret. Uses timing-safe comparison to prevent timing attacks.
 *
 * **Synchronous, no I/O.** Never throws unexpectedly; see throws section below.
 *
 * @param payload - The raw webhook payload (Buffer or string).
 * @param secret - The HMAC secret. Must be defined.
 * @param signatureHeader - The incoming signature header value.
 * @param algorithm - The HMAC algorithm ("sha1", "sha256", or "sha512").
 * @param headerName - The header name (for error messages).
 * @param prefix - The expected signature prefix (e.g., "sha256=").
 * @param providerName - The provider name (for error messages, e.g., "GitHub").
 * @returns Nothing. Resolves without error if the signature is valid.
 *
 * @throws {WebhookSignatureError} If verification fails:
 *   - Missing secret (500 status)
 *   - Missing signature header (401 status)
 *   - Invalid signature format (401 status)
 *   - Signature mismatch (401 status)
 *
 * **Concurrency:** Stateless. Safe to call concurrently.
 *
 * @example
 * ```ts
 * verifyWebhookSignature({
 *   payload: rawBody,
 *   secret: process.env.GITHUB_WEBHOOK_SECRET,
 *   signatureHeader: req.header('x-hub-signature-256'),
 *   algorithm: 'sha256',
 *   headerName: 'x-hub-signature-256',
 *   prefix: 'sha256=',
 *   providerName: 'GitHub'
 * }); // throws if invalid
 * ```
 */
export function verifyWebhookSignature({
  payload,
  secret,
  signatureHeader,
  algorithm,
  headerName,
  prefix,
  providerName,
}: VerifyWebhookSignatureInput): void {
  if (!secret) {
    throw new WebhookSignatureError(`Missing ${providerName} webhook secret configuration.`, 500);
  }

  const signature = normalizeSignature(signatureHeader);
  if (!signature) {
    throw new WebhookSignatureError(`Missing ${providerName} webhook signature in ${headerName}.`, 401);
  }

  if (!signature.startsWith(prefix)) {
    throw new WebhookSignatureError(`Invalid ${providerName} webhook signature format.`, 401);
  }

  const expectedSignature = signWebhookPayload({
    payload,
    secret,
    algorithm,
    prefix,
  });

  const providedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (providedBytes.length !== expectedBytes.length) {
    throw new WebhookSignatureError(`Invalid ${providerName} webhook signature.`, 401);
  }

  if (!timingSafeEqual(providedBytes, expectedBytes)) {
    throw new WebhookSignatureError(`Invalid ${providerName} webhook signature.`, 401);
  }
}

/**
 * Verifies a GitHub webhook signature using the preferred SHA-256 algorithm.
 *
 * Shorthand for {@link verifyWebhookSignature} with GitHub SHA-256 profile.
 * Always uses the `X-Hub-Signature-256` header.
 *
 * **Synchronous, no I/O.** Never throws unexpectedly; see throws section.
 *
 * @param payload - The raw webhook payload (Buffer or string).
 * @param secret - The GitHub webhook secret.
 * @param signatureHeader - The incoming `x-hub-signature-256` header value.
 * @returns Nothing. Resolves without error if the signature is valid.
 *
 * @throws {WebhookSignatureError} If verification fails (see {@link verifyWebhookSignature}).
 *
 * **Concurrency:** Stateless. Safe to call concurrently.
 */
export function verifyGitHubWebhookSignature(input: {
  payload: Buffer | string;
  secret: string | undefined;
  signatureHeader: string | string[] | undefined;
}): void {
  verifyWebhookSignature({
    ...githubWebhookSignatureProfile,
    ...input,
  });
}

/**
 * Verifies a GitHub webhook signature with algorithm negotiation.
 *
 * Attempts signature verification in preference order:
 *  1. **X-Hub-Signature-256** (HMAC-SHA256) — preferred, verified when present.
 *  2. **X-Hub-Signature** (HMAC-SHA1) — accepted as a fallback; a warning is logged to encourage migration.
 *  3. **Neither header present** — throws a 401 error.
 *
 * This function supports legacy webhook configurations without requiring an immediate update,
 * while guiding operators toward SHA-256.
 *
 * **Synchronous, no I/O.** Never throws unexpectedly; see throws section.
 *
 * @param payload - The raw webhook payload (Buffer or string).
 * @param secret - The GitHub webhook secret.
 * @param headers - The incoming request headers object (Express `req.headers`).
 * @returns Nothing. Resolves without error if the signature is valid.
 *
 * @throws {WebhookSignatureError} If verification fails:
 *   - Neither SHA-256 nor SHA-1 header present (401 status)
 *   - Signature verification fails for the selected algorithm (401 status)
 *   - Missing secret (500 status)
 *
 * **Concurrency:** Stateless. Safe to call concurrently.
 *
 * @example
 * ```ts
 * verifyGitHubWebhookSignatureWithNegotiation({
 *   payload: rawBody,
 *   secret: process.env.GITHUB_WEBHOOK_SECRET,
 *   headers: req.headers
 * });
 * // Tries X-Hub-Signature-256 first, then X-Hub-Signature, then throws.
 * ```
 */
export function verifyGitHubWebhookSignatureWithNegotiation(input: {
  payload: Buffer | string;
  secret: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}): void {
  const { payload, secret, headers } = input;

  const sha256Header = headers["x-hub-signature-256"];
  const sha1Header   = headers["x-hub-signature"];

  if (sha256Header) {
    // Preferred path — verify with HMAC-SHA256
    verifyWebhookSignature({
      ...githubWebhookSignatureProfile,
      payload,
      secret,
      signatureHeader: sha256Header,
    });
    return;
  }

  if (sha1Header) {
    // Legacy fallback — verify with HMAC-SHA1 and warn the operator
    logger.warn(
      {
        hint: "Configure your GitHub webhook to send X-Hub-Signature-256 (SHA-256) instead.",
      },
      "[WebhookSignature] SHA-1 fallback used — X-Hub-Signature-256 header not present. " +
        "SHA-1 is weaker; migrate your webhook to use SHA-256.",
    );

    verifyWebhookSignature({
      ...githubWebhookSignatureSha1Profile,
      payload,
      secret,
      signatureHeader: sha1Header,
    });
    return;
  }

  // Neither header present — reject the request
  throw new WebhookSignatureError(
    "Missing GitHub webhook signature. " +
      "Expected X-Hub-Signature-256 (preferred) or X-Hub-Signature (legacy).",
    401,
  );
}

/**
 * Express middleware hook to capture the raw request body before parsing.
 *
 * Called by `express.json({ verify: captureRawBody })`. Stores the raw bytes
 * in `req.rawBody` for later use by signature verification middleware.
 *
 * **Synchronous, no I/O.** Never throws.
 *
 * @param req - Express request object (augmented with `rawBody` property).
 * @param _res - Express response object (unused).
 * @param buf - The raw body buffer from the parser.
 *
 * **Concurrency:** One invocation per request. Safe to use with concurrent requests
 * because each request gets its own `req` object.
 *
 * @internal
 */
export function captureRawBody(req: Request, _res: unknown, buf: Buffer): void {
  (req as RawBodyRequest).rawBody = Buffer.from(buf);
}

/**
 * Creates Express middleware to verify webhook signatures.
 *
 * Verifies the incoming webhook signature against the configured profile.
 * If verification fails, responds with a JSON error and the appropriate HTTP status.
 * If verification succeeds, calls `next()` to pass control to the route handler.
 *
 * The secret can be static (a string) or dynamic (a callable that returns the current secret).
 * Dynamic secrets support rotation: call the resolver to get the current secret at request time.
 *
 * **Behavior:**
 * - Checks for raw body (required for signature verification). If missing, responds 500.
 * - Verifies the signature using {@link verifyWebhookSignature}.
 * - On {@link WebhookSignatureError}: responds with the error message and `statusCode`.
 * - On other errors: passes them to the next error handler.
 * - On success: calls `next()`.
 *
 * **Concurrency:** Each request is handled independently. Safe to use with concurrent requests.
 *
 * @param secret - A static string or callable that returns the webhook secret.
 * @param profile - The webhook signature profile (algorithm, header name, prefix, provider name).
 * @returns Express middleware function.
 *
 * @example
 * ```ts
 * const middleware = createWebhookSignatureMiddleware({
 *   secret: process.env.GITHUB_WEBHOOK_SECRET,
 *   algorithm: 'sha256',
 *   headerName: 'x-hub-signature-256',
 *   prefix: 'sha256=',
 *   providerName: 'GitHub'
 * });
 *
 * app.post('/webhooks/github', middleware, (req, res) => {
 *   // Signature verified at this point
 *   res.json({ received: true });
 * });
 * ```
 */
export function createWebhookSignatureMiddleware({
  secret,
  ...profile
}: WebhookSignatureMiddlewareOptions): RequestHandler {
  return (req, res, next) => {
    try {
      const rawBody = (req as RawBodyRequest).rawBody;
      if (!rawBody) {
        throw new WebhookSignatureError(
          `Raw request body is required to verify ${profile.providerName} webhook signatures.`,
          500,
        );
      }

      verifyWebhookSignature({
        ...profile,
        payload: rawBody,
        secret: resolveSecret(secret),
        signatureHeader: req.header(profile.headerName),
      });
      next();
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}

/**
 * Creates Express middleware to verify GitHub webhook signatures.
 *
 * Shorthand for {@link createWebhookSignatureMiddleware} with the preferred GitHub SHA-256 profile.
 *
 * @param secret - A static string or callable that returns the GitHub webhook secret.
 * @returns Express middleware function for verifying GitHub webhooks.
 *
 * @example
 * ```ts
 * app.post(
 *   '/api/webhooks/github',
 *   createGitHubWebhookSignatureMiddleware(() => process.env.GITHUB_WEBHOOK_SECRET),
 *   (req, res) => {
 *     res.json({ authenticated: true });
 *   }
 * );
 * ```
 *
 * **Concurrency:** Each request is handled independently. Safe with concurrent requests.
 */
export function createGitHubWebhookSignatureMiddleware(secret: SecretResolver): RequestHandler {
  return createWebhookSignatureMiddleware({
    ...githubWebhookSignatureProfile,
    secret,
  });
}

/**
 * Options for verifying webhook signatures during a secret rotation.
 *
 * Extends {@link WebhookSignatureProfile} with new and previous secrets, and rotation timing.
 */
export interface SecretRotationOptions extends WebhookSignatureProfile {
  /** The request payload to verify. */
  payload: Buffer | string;
  /** The incoming signature header value. */
  signatureHeader: string | string[] | undefined;
  /** The newly configured secret (always attempted first). */
  newSecret: string;
  /**
   * The previous secret kept alive during the rotation grace period.
   * Pass `undefined` when no rotation is in progress.
   */
  previousSecret?: string;
  /**
   * Milliseconds to allow the old secret after rotation starts.
   * Defaults to 5 minutes (300_000 ms).
   */
  gracePeriodMs?: number;
  /**
   * The timestamp when the secret rotation began (from `Date.now()`).
   * Required when `previousSecret` is supplied; ignored otherwise.
   */
  rotationStartedAt?: number;
}

/**
 * Verifies a webhook signature during a secret rotation.
 *
 * **Acceptance logic:**
 * - A request signed with `newSecret` is **always** accepted.
 * - A request signed with `previousSecret` is accepted only while the grace period
 *   has not expired (`now < rotationStartedAt + gracePeriodMs`).
 * - Any request that matches neither secret is rejected.
 *
 * This allows a smooth transition when rotating secrets: pending webhooks signed with
 * the old secret are still accepted during the grace period, while new webhooks must
 * use the new secret. After the grace period expires, only the new secret is accepted.
 *
 * **Synchronous, no I/O.** Never throws unexpectedly; see throws section.
 *
 * @param payload - The raw webhook payload (Buffer or string).
 * @param signatureHeader - The incoming signature header value.
 * @param newSecret - The currently active secret (always tried first).
 * @param previousSecret - The old secret from the previous rotation (optional).
 * @param gracePeriodMs - Grace period duration in milliseconds (default: 300000 = 5 min).
 * @param rotationStartedAt - Unix timestamp (ms) when rotation started (required if `previousSecret` is supplied).
 * @param algorithm - The HMAC algorithm.
 * @param headerName - The header name (for error messages).
 * @param prefix - The expected signature prefix.
 * @param providerName - The provider name (for error messages).
 * @returns Nothing. Resolves without error if the signature matches either secret within the grace period.
 *
 * @throws {WebhookSignatureError} If the signature matches neither the new nor previous secret (401 status).
 *
 * **Concurrency:** Stateless. Safe to call concurrently.
 *
 * @example
 * ```ts
 * const rotationStartedAt = Date.now();
 * const newSecret = generateNewSecret();
 * const oldSecret = process.env.GITHUB_WEBHOOK_SECRET;
 *
 * verifyWithSecretRotation({
 *   payload: rawBody,
 *   signatureHeader: req.header('x-hub-signature-256'),
 *   newSecret,
 *   previousSecret: oldSecret,
 *   rotationStartedAt,
 *   gracePeriodMs: 300_000, // 5 minutes
 *   algorithm: 'sha256',
 *   headerName: 'x-hub-signature-256',
 *   prefix: 'sha256=',
 *   providerName: 'GitHub'
 * }); // Accepts signatures from either secret during the grace period
 * ```
 */
export function verifyWithSecretRotation({
  payload,
  signatureHeader,
  newSecret,
  previousSecret,
  gracePeriodMs = 300_000,
  rotationStartedAt,
  ...profile
}: SecretRotationOptions): void {
  // Normalise the incoming header once.
  const normalizedSignature = normalizeSignature(signatureHeader);
  if (!normalizedSignature) {
    throw new WebhookSignatureError(
      `Missing ${profile.providerName} webhook signature in ${profile.headerName}.`,
      401,
    );
  }

  if (!normalizedSignature.startsWith(profile.prefix)) {
    throw new WebhookSignatureError(
      `Invalid ${profile.providerName} webhook signature format.`,
      401,
    );
  }

  // Re-bind to a definitely-string const: TypeScript's narrowing above does
  // not flow into the nested function declaration below.
  const signature: string = normalizedSignature;

  // Helper: compute and compare a single candidate secret (timing-safe).
  function matchesSecret(candidate: string): boolean {
    const expected = signWebhookPayload({
      payload,
      secret: candidate,
      algorithm: profile.algorithm,
      prefix: profile.prefix,
    });
    const providedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (providedBytes.length !== expectedBytes.length) return false;
    return timingSafeEqual(providedBytes, expectedBytes);
  }

  // 1. Always try the new secret first.
  if (matchesSecret(newSecret)) return;

  // 2. During the grace period, also try the previous secret.
  if (previousSecret !== undefined && rotationStartedAt !== undefined) {
    const withinGracePeriod = Date.now() < rotationStartedAt + gracePeriodMs;
    if (withinGracePeriod && matchesSecret(previousSecret)) return;
  }

  // 3. Nothing matched — reject.
  throw new WebhookSignatureError(
    `Invalid ${profile.providerName} webhook signature.`,
    401,
  );
}
