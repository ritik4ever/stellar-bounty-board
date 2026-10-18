import type { Request, RequestHandler } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { listBounties } from '../services/bountyStore';

const HEADER_SIGNATURE = 'x-stellar-signature';
const HEADER_PUBLIC_KEY = 'x-stellar-public-key';
const ENV_PUBLIC_KEY = 'MAINTAINER_PUBLIC_KEY';
const ENV_PUBLIC_KEYS = 'MAINTAINER_PUBLIC_KEYS';

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
  const rawKeys = process.env[ENV_PUBLIC_KEYS] ?? process.env[ENV_PUBLIC_KEY] ?? '';
  return rawKeys
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getRequestPayload(req: Request): Buffer {
  const rawBody = (req as RawBodyRequest).rawBody;
  if (rawBody && rawBody.length > 0) {
    return rawBody;
  }

  if (req.body !== undefined && req.body !== null) {
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }

  return Buffer.from(`${req.method} ${req.originalUrl}`, 'utf8');
}

function decodeSignatureVariants(signatureHeader: string): Buffer[] {
  const normalized = signatureHeader
    .trim()
    .replace(/^(?:0x|sig=|signature=)/i, '')
    .trim();
  const candidates: Buffer[] = [];

  if (/^[0-9a-fA-F]+$/.test(normalized) && normalized.length % 2 === 0) {
    candidates.push(Buffer.from(normalized, 'hex'));
  }

  candidates.push(Buffer.from(normalized, 'base64'));
  return candidates;
}

function verifyStellarSignature(
  publicKey: string,
  payload: Buffer,
  signatureHeader: string
): boolean {
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

/**
 * Verifies that a payload was cryptographically signed by the provided Stellar public key.
 * Compatible with Freighter wallet `signMessage` outputs and Stellar SDK keypairs.
 */
export function verifyWalletSignature(
  publicKey: string,
  payload: Buffer,
  signatureHeader: string
): boolean {
  return verifyStellarSignature(publicKey, payload, signatureHeader);
}

/**
 * Asserts that the authenticated caller's public key matches the expected maintainer address.
 */
export function verifyCallerIsMaintainer(
  signerPublicKey: string,
  expectedMaintainer: string
): boolean {
  if (!signerPublicKey || !expectedMaintainer) {
    return false;
  }
  return signerPublicKey.trim() === expectedMaintainer.trim();
}

/**
 * Verifies that a bounty-creation request was signed by the maintainer named
 * in its body.
 *
 * The signed message is the UTF-8 JSON of
 * `{ repo, issueNumber, amount, tokenSymbol, deadline }` in that key order,
 * where `deadline` is taken from `body.deadlineDays`. The signature comes from
 * the `x-stellar-signature` header, as hex or base64, optionally prefixed with
 * `0x`, `sig=` or `signature=`. It is checked against `body.maintainer`.
 *
 * Must run after `express.json()`. Skipped entirely (calls `next()`) when
 * `NODE_ENV === "test"` unless `STELLAR_AUTH_ENFORCED === "true"`.
 *
 * Responds 401 when the header is missing, `body.maintainer` is missing or
 * not a string, or the signature does not verify (including when
 * `maintainer` is not a valid Stellar public key).
 *
 * Never throws and never calls `next(err)`; key-parsing and verification
 * errors from the Stellar SDK are treated as a failed verification.
 *
 * Concurrency: stateless. Unlike {@link createStellarSignatureAuthMiddleware},
 * there is no replay protection or timestamp check; duplicate creates are
 * handled downstream.
 *
 * @returns A synchronous Express middleware.
 */
export function createBountyCreationSignatureMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test' && process.env.STELLAR_AUTH_ENFORCED !== 'true') {
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

    if (!maintainer || typeof maintainer !== 'string') {
      res
        .status(401)
        .json({ error: 'Missing maintainer field required for signature verification.' });
      return;
    }

    const canonicalPayload = Buffer.from(
      JSON.stringify({ repo, issueNumber, amount, tokenSymbol, deadline: deadlineDays }),
      'utf8'
    );

    if (!verifyStellarSignature(maintainer, canonicalPayload, signatureHeader)) {
      res
        .status(401)
        .json({
          error: 'Invalid Stellar signature. Signer public key must match maintainer address.',
        });
      return;
    }

    next();
  };
}

class NonceCache {
  private nonces = new Map<string, number>();

  has(nonce: string): boolean {
    const expiry = this.nonces.get(nonce);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      this.nonces.delete(nonce);
      return false;
    }
    return true;
  }

  add(nonce: string, ttlMs: number) {
    this.nonces.set(nonce, Date.now() + ttlMs);
  }

  cleanup() {
    const now = Date.now();
    for (const [nonce, expiry] of this.nonces.entries()) {
      if (now > expiry) {
        this.nonces.delete(nonce);
      }
    }
  }
}

const nonceCache = new NonceCache();

/**
 * Authenticates maintainer actions on an existing bounty (routes with an
 * `:id` param, such as release and refund) using a Stellar / Freighter signature.
 *
 * Checks, in order, responding 401 on the first failure unless noted:
 *  1. At least one key is configured in `MAINTAINER_PUBLIC_KEYS`
 *     (comma-separated) or `MAINTAINER_PUBLIC_KEY`. Responds 500 if not.
 *  2. `x-stellar-signature` and `x-stellar-public-key` headers are present.
 *  3. The public key is in the configured list.
 *  4. `body.action` and `body.bountyId` are non-empty strings, and
 *     `body.bountyId === req.params.id`.
 *  5. `body.timestamp` is a number (Unix seconds) within 60s of server time,
 *     in either direction.
 *  6. The signature has not been seen in the last 60s (replay protection).
 *  7. The signature verifies over the raw request body (`req.rawBody`, set by
 *     the `express.json` `verify` hook), falling back to `JSON.stringify(body)`
 *     and then to `"<METHOD> <originalUrl>"` when there is no body.
 *  8. If `body.maintainer` is a string, it equals the signer public key.
 *  9. If the target bounty exists in the store, the signer public key must match
 *     the bounty's stored maintainer. Responds 403 on mismatch.
 *
 * On success sets `req.signerPublicKey` and calls `next()`. Skipped entirely
 * (calls `next()`) when `NODE_ENV === "test"` unless `STELLAR_AUTH_ENFORCED === "true"`.
 * Configuration is read from the environment on every request.
 *
 * Never throws and never calls `next(err)`; SDK errors count as a failed
 * verification.
 *
 * Concurrency: the replay cache is a module-level in-memory `Map` shared by
 * every middleware instance in the process. Check-and-insert is synchronous,
 * so it is race-free within one process, but it is **not** shared across
 * processes or replicas, and is empty after a restart. A signature is recorded
 * as used once it verifies, before the maintainer check in step 8, so a
 * request rejected at step 8 cannot be retried with the same signature.
 *
 * @returns A synchronous Express middleware.
 */
export function createStellarSignatureAuthMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test' && process.env.STELLAR_AUTH_ENFORCED !== 'true') {
      next();
      return;
    }

    const allowedMaintainerKeys = getMaintainerPublicKeys();
    if (allowedMaintainerKeys.length === 0) {
      res.status(500).json({ error: 'Server maintainer public key configuration is missing.' });
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
      res.status(401).json({ error: 'Unauthorized Stellar public key.' });
      return;
    }

    const { action, bountyId, timestamp } = req.body ?? {};

    if (!action || typeof action !== 'string') {
      res.status(401).json({ error: 'Invalid or missing action in request body.' });
      return;
    }

    if (!bountyId || typeof bountyId !== 'string') {
      res.status(401).json({ error: 'Invalid or missing bountyId in request body.' });
      return;
    }

    if (bountyId !== req.params.id) {
      res.status(401).json({ error: 'Request bountyId does not match the request path.' });
      return;
    }

    if (typeof timestamp !== 'number') {
      res.status(401).json({ error: 'Invalid or missing timestamp in request body.' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 60) {
      res.status(401).json({ error: 'Signature timestamp has expired or is invalid.' });
      return;
    }

    nonceCache.cleanup();
    if (nonceCache.has(signatureHeader)) {
      res.status(401).json({ error: 'Replay attack detected: signature already processed.' });
      return;
    }

    const payload = getRequestPayload(req);
    if (!verifyStellarSignature(publicKeyHeader, payload, signatureHeader)) {
      res.status(401).json({ error: 'Invalid Stellar signature.' });
      return;
    }

    nonceCache.add(signatureHeader, 60 * 1000);

    // Attach the authenticated signer's public key for audit logging downstream
    req.signerPublicKey = publicKeyHeader;

    const maintainer = typeof req.body?.maintainer === 'string' ? req.body.maintainer : undefined;
    if (maintainer && maintainer !== publicKeyHeader) {
      res.status(401).json({ error: 'Request maintainer does not match signer public key.' });
      return;
    }

    // Match caller's proven address against the bounty's stored maintainer
    const targetBountyId = req.params?.id || bountyId;
    if (targetBountyId) {
      try {
        const records = listBounties();
        const storedBounty = records.find((b) => b.id === targetBountyId);
        if (
          storedBounty &&
          storedBounty.maintainer &&
          storedBounty.maintainer !== publicKeyHeader
        ) {
          res
            .status(403)
            .json({ error: 'Signer public key does not match stored bounty maintainer.' });
          return;
        }
      } catch {
        // Fallback gracefully if store lookup is not available
      }
    }

    next();
  };
}
