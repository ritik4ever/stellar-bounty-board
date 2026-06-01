import type { Request, RequestHandler } from "express";
import { Keypair } from "stellar-sdk";

const HEADER_SIGNATURE = "x-stellar-signature";
const HEADER_PUBLIC_KEY = "x-stellar-public-key";
const ENV_PUBLIC_KEY = "MAINTAINER_PUBLIC_KEY";
const ENV_PUBLIC_KEYS = "MAINTAINER_PUBLIC_KEYS";

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

export function createBountyCreationSignatureMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }

    const signatureHeader = normalizeHeaderValue(req.header(HEADER_SIGNATURE));
    if (!signatureHeader) {
      res.status(401).json({ error: `Missing ${HEADER_SIGNATURE} header.` });
      return;
    }

    const body = req.body ?? {};
    const { repo, issueNumber, amount, tokenSymbol, deadlineDays, maintainer } = body;

    if (!maintainer || typeof maintainer !== "string") {
      res.status(401).json({ error: "Missing maintainer field required for signature verification." });
      return;
    }

    // Canonical payload the client must sign: { repo, issueNumber, amount, tokenSymbol, deadline }
    const canonicalPayload = Buffer.from(
      JSON.stringify({ repo, issueNumber, amount, tokenSymbol, deadline: deadlineDays }),
      "utf8",
    );

    if (!verifyStellarSignature(maintainer, canonicalPayload, signatureHeader)) {
      res.status(401).json({ error: "Invalid Stellar signature. Signer public key must match maintainer address." });
      return;
    }

    next();
  };
}

export function createStellarSignatureAuthMiddleware(): RequestHandler {
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

    next();
  };
}
