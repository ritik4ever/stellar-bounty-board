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
