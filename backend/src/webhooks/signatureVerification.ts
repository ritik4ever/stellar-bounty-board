import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { logger } from "../logger";

type HmacAlgorithm = "sha1" | "sha256" | "sha512";
type SecretResolver = string | (() => string | undefined);

export interface WebhookSignatureProfile {
  algorithm: HmacAlgorithm;
  headerName: string;
  prefix: string;
  providerName: string;
}

export interface VerifyWebhookSignatureInput extends WebhookSignatureProfile {
  payload: Buffer | string;
  secret: string | undefined;
  signatureHeader: string | string[] | undefined;
}

export interface WebhookSignatureMiddlewareOptions extends WebhookSignatureProfile {
  secret: SecretResolver;
}

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

export class WebhookSignatureError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export const githubWebhookSignatureProfile: WebhookSignatureProfile = {
  algorithm: "sha256",
  headerName: "x-hub-signature-256",
  prefix: "sha256=",
  providerName: "GitHub",
};

/**
 * Legacy GitHub signature profile that uses HMAC-SHA1 via the X-Hub-Signature header.
 * GitHub still sends this header for webhook configurations created before SHA-256 support.
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads#delivery-headers
 */
export const githubWebhookSignatureSha1Profile: WebhookSignatureProfile = {
  algorithm: "sha1",
  headerName: "x-hub-signature",
  prefix: "sha1=",
  providerName: "GitHub",
};

function resolveSecret(secret: SecretResolver): string | undefined {
  return typeof secret === "function" ? secret() : secret;
}

function normalizeSignature(signatureHeader: string | string[] | undefined): string | undefined {
  return Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
}

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
 * Verifies a GitHub webhook signature using algorithm negotiation.
 *
 * Preference order:
 *  1. `X-Hub-Signature-256` (HMAC-SHA256) — preferred and verified when present.
 *  2. `X-Hub-Signature`     (HMAC-SHA1)   — accepted as a fallback for legacy webhook
 *     configurations.  A `warn`-level log is emitted to encourage migration.
 *  3. Neither header present — throws a 401 `WebhookSignatureError`.
 *
 * @param payload   The raw request body buffer.
 * @param secret    The shared HMAC secret configured in GitHub.
 * @param headers   The incoming request headers object (Express `req.headers`).
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

export function captureRawBody(req: Request, _res: unknown, buf: Buffer): void {
  (req as RawBodyRequest).rawBody = Buffer.from(buf);
}

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

export function createGitHubWebhookSignatureMiddleware(secret: SecretResolver): RequestHandler {
  return createWebhookSignatureMiddleware({
    ...githubWebhookSignatureProfile,
    secret,
  });
}

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
 * Verify a webhook signature during a secret rotation.
 *
 * Acceptance logic:
 * - A request signed with `newSecret` is **always** accepted.
 * - A request signed with `previousSecret` is accepted only while the
 *   rotation grace period has not expired (`now < rotationStartedAt + gracePeriodMs`).
 * - Any request that matches neither secret is rejected, regardless of timing.
 *
 * @throws {WebhookSignatureError} when the signature cannot be verified.
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
  const signature = normalizeSignature(signatureHeader);
  if (!signature) {
    throw new WebhookSignatureError(
      `Missing ${profile.providerName} webhook signature in ${profile.headerName}.`,
      401,
    );
  }

  if (!signature.startsWith(profile.prefix)) {
    throw new WebhookSignatureError(
      `Invalid ${profile.providerName} webhook signature format.`,
      401,
    );
  }

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
