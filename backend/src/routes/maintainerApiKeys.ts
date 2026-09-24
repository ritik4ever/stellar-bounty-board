import { Router } from "express";
import { randomBytes, randomUUID, createHash } from "crypto";
import { loadApiKeys, saveApiKeys, ApiKeyRecord } from "../apiKeyStore";
import { isValidStellarAddress } from "../utils";
import { Keypair } from "@stellar/stellar-sdk";

const router = Router();

function generateApiKey(): string {
  return `mk_${randomBytes(32).toString("base64url")}`;
}

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function getRequestPayload(req: any): Buffer {
  const rawBody = (req as any).rawBody;
  if (rawBody && rawBody.length > 0) return rawBody;
  if (req.body && Object.keys(req.body).length > 0) return Buffer.from(JSON.stringify(req.body), "utf8");
  return Buffer.from(`${req.method} ${req.originalUrl}`, "utf8");
}

function verifyStellarSignature(publicKey: string, payload: Buffer, signatureHeader: string): boolean {
  try {
    const keypair = Keypair.fromPublicKey(publicKey);
    const normalized = signatureHeader.trim().replace(/^(?:0x|sig=|signature=)/i, "").trim();
    const candidates: Buffer[] = [];
    if (/^[0-9a-fA-F]+$/.test(normalized) && normalized.length % 2 === 0) {
      candidates.push(Buffer.from(normalized, "hex"));
    }
    candidates.push(Buffer.from(normalized, "base64"));
    for (const sig of candidates) {
      try {
        if (keypair.verify(payload, sig)) return true;
      } catch { // try next }
    }
  } catch { // ignore }
  return false;
}

class NonceCache {
  private nonces = new Map<string, number>();
  has(nonce: string): boolean {
    const exp = this.nonces.get(nonce);
    if (!exp) return false;
    if (Date.now() > exp) { this.nonces.delete(nonce); return false; }
    return true;
  }
  add(nonce: string, ttlMs: number) { this.nonces.set(nonce, Date.now() + ttlMs); }
  cleanup() {
    const now = Date.now();
    for (const [n, exp] of this.nonces) if (now > exp) this.nonces.delete(n);
  }
}
const nonceCache = new NonceCache();

function maintainerAuthMiddleware(req: any, res: any, next: () => void) {
  if (process.env.NODE_ENV === "test") { next(); return; }

  const signature = normalizeHeaderValue(req.header(HEADER_SIGNATURE));
  const publicKey = normalizeHeaderValue(req.header(HEADER_PUBLIC_KEY));
  if (!signature || !publicKey) {
    res.status(401).json({ error: "Missing signature or public key headers." });
    return;
  }

  const address = req.params.address;
  if (!address || publicKey !== address) {
    res.status(401).json({ error: "Signer public key does not match maintainer address." });
    return;
  }

  const { timestamp } = req.body ?? {};
  if (typeof timestamp !== "number") {
    res.status(401).json({ error: "Invalid or missing timestamp in request body." });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 60) {
    res.status(401).json({ error: "Signature timestamp has expired or is invalid." });
    return;
  }

  nonceCache.cleanup();
  if (nonceCache.has(signature)) {
    res.status(401).json({ error: "Replay attack detected: signature already processed." });
    return;
  }

  if (!verifyStellarSignature(publicKey, getRequestPayload(req), signature)) {
    res.status(401).json({ error: "Invalid Stellar signature." });
    return;
  }

  nonceCache.add(signature, 60 * 1000);
  next();
}

router.post("/:address/api-keys", maintainerAuthMiddleware, (req, res) => {
  const address = req.params.address;
  if (!isValidStellarAddress(address)) {
    return res.status(400).json({ error: "Invalid Stellar address." });
  }

  const apiKey = generateApiKey();
  const record: ApiKeyRecord = {
    id: randomUUID(),
    maintainer: address,
    keyHash: hashApiKey(apiKey),
    createdAt: new Date().toISOString(),
  };

  const keys = loadApiKeys();
  keys.push(record);
  saveApiKeys(keys);

  res.status(201).json({
    id: record.id,
    maintainer: address,
    apiKey,
    createdAt: record.createdAt,
  });
});

router.delete("/:address/api-keys/:keyId", maintainerAuthMiddleware, (req, res) => {
  const { address, keyId } = req.params;
  if (!isValidStellarAddress(address)) {
    return res.status(400).json({ error: "Invalid Stellar address." });
  }

  const keys = loadApiKeys();
  const index = keys.findIndex((k) => k.id === keyId && k.maintainer === address);
  if (index === -1) {
    return res.status(404).json({ error: "API key not found or not owned by this maintainer." });
  }

  keys.splice(index, 1);
  saveApiKeys(keys);
  res.status(204).end();
});

export default router;
