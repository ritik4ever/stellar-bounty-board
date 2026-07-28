import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";

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

/** Dedup window for webhook delivery IDs (10 minutes). */
export const WEBHOOK_DEDUP_TTL_MS = 10 * 60 * 1_000;

const deliveryStore = new Map<string, number>();

/**
 * Checks (and records) the X-Hub-Delivery header to prevent replay attacks.
 * Returns `true` if the delivery has already been processed within the
 * dedup window, `false` if this is the first time seeing it.
 */
export function isReplayedDelivery(deliveryId: string | undefined): boolean {
  if (!deliveryId) return false;

  const now = Date.now();
  const processedAt = deliveryStore.get(deliveryId);

  if (processedAt !== undefined) {
    if (now - processedAt < WEBHOOK_DEDUP_TTL_MS) {
      return true; // replayed within the window
    }
    // Window expired — allow re-processing (stale entry cleaned below)
    deliveryStore.delete(deliveryId);
  }

  // Prune expired entries periodically (every ~1% of TTL)
  if (deliveryStore.size % 100 === 0) {
    const cutoff = now - WEBHOOK_DEDUP_TTL_MS;
    for (const [key, ts] of deliveryStore) {
      if (ts < cutoff) deliveryStore.delete(key);
    }
  }

  deliveryStore.set(deliveryId, now);
  return false;
}

/** Resets the delivery-ID store (for tests only). */
export function __resetDeliveryStoreForTests(): void {
  deliveryStore.clear();
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
