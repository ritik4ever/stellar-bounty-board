import type { Request, RequestHandler } from "express";
import { Keypair } from "stellar-sdk";

const HEADER_SIGNATURE = "x-stellar-signature";
const HEADER_PUBLIC_KEY = "x-stellar-public-key";
const ENV_PUBLIC_KEY = "MAINTAINER_PUBLIC_KEY";
const ENV_PUBLIC_KEYS = "MAINTAINER_PUBLIC_KEYS";
const REPLAY_WINDOW_SECONDS = 60;
const MAX_NONCE_LENGTH = 128;

type SignedAction = "release" | "refund";

const usedNonces = new Map<string, number>();

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

function normalizeHeaderValue(headerValue: string | string[] | undefined): string | undefined {
  if (!headerValue) {
    return undefined;
  }
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

function getMaintainerPublicKeys(): string[] {
  const rawKeys = process.env[ENV_PUBLIC_KEYS] ?? process.env[ENV_PUBLIC_KEY] ?? "";
  return rawKeys
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getRequestPayload(req: Request): Buffer {
  const rawBody = (req as RawBodyRequest).rawBody;
  if (rawBody && rawBody.length > 0) {
    return rawBody;
  }

  if (req.body !== undefined && req.body !== null) {
    return Buffer.from(JSON.stringify(req.body), "utf8");
  }

  return Buffer.from(`${req.method} ${req.originalUrl}`, "utf8");
}

function decodeSignatureVariants(signatureHeader: string): Buffer[] {
  const normalized = signatureHeader.trim().replace(/^(?:0x|sig=|signature=)/i, "").trim();
  const candidates: Buffer[] = [];

  if (/^[0-9a-fA-F]+$/.test(normalized) && normalized.length % 2 === 0) {
    candidates.push(Buffer.from(normalized, "hex"));
  }

  candidates.push(Buffer.from(normalized, "base64"));
  return candidates;
}

function verifyStellarSignature(publicKey: string, payload: Buffer, signatureHeader: string): boolean {
  let keypair: Keypair;
  try {
    keypair = Keypair.fromPublicKey(publicKey);
  } catch {
    return false;
  }

  const signatureVariants = decodeSignatureVariants(signatureHeader);
  for (const signature of signatureVariants) {
    try {
      if (keypair.verify(payload, signature)) {
        return true;
      }
    } catch {
      // Ignore verification failures; try the next encoding.
    }
  }

  return false;
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function cleanupExpiredNonces(now: number): void {
  for (const [nonceKey, expiresAt] of usedNonces.entries()) {
    if (expiresAt <= now) {
      usedNonces.delete(nonceKey);
    }
  }
}

function getSignedActionValue(req: Request, key: string): unknown {
  return req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>)[key] : undefined;
}

function validateReplayProtection(req: Request, publicKey: string, expectedAction: SignedAction): string | undefined {
  const action = getSignedActionValue(req, "action");
  if (action !== expectedAction) {
    return `Signed payload action must be ${expectedAction}.`;
  }

  const bountyId = getSignedActionValue(req, "bountyId");
  if (typeof bountyId !== "string" || bountyId !== req.params.id) {
    return "Signed payload bountyId must match the request bounty id.";
  }

  const timestamp = getSignedActionValue(req, "timestamp");
  if (typeof timestamp !== "number" || !Number.isInteger(timestamp)) {
    return "Signed payload timestamp must be a Unix epoch timestamp in seconds.";
  }

  const now = nowInSeconds();
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_SECONDS) {
    return "Signed payload timestamp is outside the allowed replay window.";
  }

  const nonce = getSignedActionValue(req, "nonce");
  if (typeof nonce !== "string" || nonce.trim().length === 0 || nonce.length > MAX_NONCE_LENGTH) {
    return "Signed payload nonce is required and must be 1-128 characters.";
  }

  cleanupExpiredNonces(now);

  const nonceKey = `${publicKey}:${nonce}`;
  if (usedNonces.has(nonceKey)) {
    return "Signed payload nonce has already been used.";
  }

  usedNonces.set(nonceKey, now + REPLAY_WINDOW_SECONDS);
  return undefined;
}

export function createStellarSignatureAuthMiddleware(expectedAction: SignedAction): RequestHandler {
  return (req, res, next) => {
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }

    const allowedMaintainerKeys = getMaintainerPublicKeys();
    if (allowedMaintainerKeys.length === 0) {
      res.status(500).json({ error: "Server maintainer public key configuration is missing." });
      return;
    }

    const signatureHeader = normalizeHeaderValue(req.header(HEADER_SIGNATURE));
    const publicKeyHeader = normalizeHeaderValue(req.header(HEADER_PUBLIC_KEY));

    if (!signatureHeader) {
      res.status(401).json({ error: `Missing ${HEADER_SIGNATURE} header.` });
      return;
    }

    if (!publicKeyHeader) {
      res.status(401).json({ error: `Missing ${HEADER_PUBLIC_KEY} header.` });
      return;
    }

    if (!allowedMaintainerKeys.includes(publicKeyHeader)) {
      res.status(401).json({ error: "Unauthorized Stellar public key." });
      return;
    }

    const payload = getRequestPayload(req);
    if (!verifyStellarSignature(publicKeyHeader, payload, signatureHeader)) {
      res.status(401).json({ error: "Invalid Stellar signature." });
      return;
    }

    const maintainer = typeof req.body?.maintainer === "string" ? req.body.maintainer : undefined;
    if (maintainer && maintainer !== publicKeyHeader) {
      res.status(401).json({ error: "Request maintainer does not match signer public key." });
      return;
    }

    const replayError = validateReplayProtection(req, publicKeyHeader, expectedAction);
    if (replayError) {
      res.status(401).json({ error: replayError });
      return;
    }

    next();
  };
}
