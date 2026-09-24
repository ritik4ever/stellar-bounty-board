/**
 * SEP-10 Stellar Web Authentication Service
 *
 * Implements the Stellar Ecosystem Proposal 10 (SEP-10) challenge-response
 * authentication flow:
 *
 *   1. Client requests a challenge: GET /api/auth/challenge?account=G...
 *   2. Server issues a signed challenge transaction (XDR base64).
 *   3. Client signs the transaction with its wallet keypair.
 *   4. Client submits the signed XDR: POST /api/auth/verify
 *   5. Server verifies all signatures and issues a short-lived JWT.
 *   6. Client includes the JWT in subsequent requests via `Authorization: Bearer <token>`.
 *
 * @see https://stellar.org/protocol/sep-10
 */

import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { Keypair, Networks, WebAuth } from "@stellar/stellar-sdk";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/** Network passphrase resolved from env, defaults to Testnet. */
export function resolveNetworkPassphrase(): string {
  const passphrase = process.env.SOROBAN_NETWORK_PASSPHRASE?.trim();
  if (passphrase) return passphrase;
  const network = process.env.STELLAR_NETWORK?.toLowerCase();
  if (network === "mainnet" || network === "public") return Networks.PUBLIC;
  if (network === "futurenet") return Networks.FUTURENET;
  return Networks.TESTNET;
}

/** Home domain used to identify this service in challenge ManageData keys. */
export function resolveHomeDomain(): string {
  return (
    process.env.HOME_DOMAIN?.trim() ||
    process.env.FRONTEND_URL?.replace(/^https?:\/\//, "").split("/")[0] ||
    "stellar-bounty-board.local"
  );
}

/** Web auth domain — typically the same as the home domain. */
export function resolveWebAuthDomain(): string {
  return process.env.WEB_AUTH_DOMAIN?.trim() || resolveHomeDomain();
}

/**
 * Server signing keypair. Required for challenge issuance.
 * Falls back to a deterministic test keypair in non-production so the service
 * boots without explicit config. **Set SERVER_SIGNING_SECRET in production.**
 */
export function resolveServerKeypair(): Keypair {
  const secret = process.env.SERVER_SIGNING_SECRET?.trim();
  if (secret) {
    try {
      return Keypair.fromSecret(secret);
    } catch {
      throw new Error(
        "SERVER_SIGNING_SECRET is set but is not a valid Stellar secret key (S...)."
      );
    }
  }

  // In test / development, use a fixed stable keypair so tests are reproducible.
  // This is NOT used in production — SERVER_SIGNING_SECRET is required there.
  if (process.env.NODE_ENV !== "production") {
    return Keypair.fromSecret("SB6AAXPJJ4PXNRASQRTM4PDVJ6BVZLE6DP5AHV5E4KZ3CTJD5T6MOBB2");
  }

  throw new Error(
    "SERVER_SIGNING_SECRET environment variable is required in production for SEP-10 auth."
  );
}

/** HMAC secret for JWT signing. Derived from SERVER_SIGNING_SECRET when not set. */
function resolveJwtSecret(): Buffer {
  const raw = process.env.JWT_SECRET?.trim();
  if (raw) return Buffer.from(raw, "utf8");

  const serverSecret = process.env.SERVER_SIGNING_SECRET?.trim();
  if (serverSecret) {
    return createHmac("sha256", "stellar-bounty-board-jwt")
      .update(serverSecret)
      .digest();
  }

  // Development fallback — **never** use in production.
  if (process.env.NODE_ENV !== "production") {
    return Buffer.from("dev-jwt-secret-do-not-use-in-production-32b", "utf8");
  }

  throw new Error(
    "JWT_SECRET (or SERVER_SIGNING_SECRET) environment variable is required in production."
  );
}

// ---------------------------------------------------------------------------
// Minimal HMAC-SHA256 JWT (no external deps)
// ---------------------------------------------------------------------------

const ALGORITHM = "HS256";
export const JWT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
export const CHALLENGE_TTL_SECONDS = 5 * 60; // 5 minutes

function base64UrlEncode(buf: Buffer | string): string {
  const b64 = Buffer.isBuffer(buf)
    ? buf.toString("base64")
    : Buffer.from(buf).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const mod4 = padded.length % 4;
  const padded2 = mod4 ? padded + "====".slice(mod4) : padded;
  return Buffer.from(padded2, "base64");
}

export interface JwtPayload {
  /** Stellar public key of the authenticated wallet. */
  sub: string;
  /** Issued-at (Unix seconds). */
  iat: number;
  /** Expires-at (Unix seconds). */
  exp: number;
}

/**
 * Signs a JWT payload with HMAC-SHA256.
 */
export function signJwt(payload: JwtPayload, secretOverride?: Buffer): string {
  const secret = secretOverride ?? resolveJwtSecret();
  const header = base64UrlEncode(JSON.stringify({ alg: ALGORITHM, typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

/**
 * Verifies a JWT and returns its payload.
 * Throws a descriptive error on any failure (expired, tampered, missing).
 */
export function verifyJwt(token: string, secretOverride?: Buffer): JwtPayload {
  const secret = secretOverride ?? resolveJwtSecret();
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT: expected 3 parts.");

  const [encodedHeader, encodedPayload, encodedSig] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = createHmac("sha256", secret).update(signingInput).digest();
  const actualSig = base64UrlDecode(encodedSig);

  if (
    expectedSig.length !== actualSig.length ||
    !timingSafeEqual(expectedSig, actualSig)
  ) {
    throw new Error("JWT signature verification failed.");
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as JwtPayload;
  } catch {
    throw new Error("Malformed JWT: payload is not valid JSON.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error("JWT has expired.");
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Replay-attack prevention — in-memory cache of used challenge transaction IDs
// ---------------------------------------------------------------------------

interface UsedChallenge {
  addedAt: number;
}

const usedChallenges = new Map<string, UsedChallenge>();

function pruneUsedChallenges(): void {
  const cutoff = Date.now() - CHALLENGE_TTL_SECONDS * 1000 * 2;
  for (const [nonce, entry] of usedChallenges.entries()) {
    if (entry.addedAt < cutoff) usedChallenges.delete(nonce);
  }
}

function markChallengeUsed(txHash: string): void {
  usedChallenges.set(txHash, { addedAt: Date.now() });
}

function isChallengeAlreadyUsed(txHash: string): boolean {
  return usedChallenges.has(txHash);
}

/**
 * Derive a stable nonce from the signed XDR so we can detect replays
 * without storing the full transaction.
 */
function deriveChallengeNonce(signedXdr: string): string {
  return createHash("sha256").update(signedXdr).digest("hex");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ChallengeResult {
  /** Base64-encoded XDR transaction that the client must sign. */
  transaction: string;
  /** SEP-10 network passphrase for this server. */
  network_passphrase: string;
}

/**
 * Builds a SEP-10 challenge transaction for the given Stellar account.
 *
 * @param clientAccountId  G... or M... address of the requesting wallet.
 * @returns  `{ transaction, network_passphrase }` as per SEP-10 spec.
 */
export function buildChallenge(clientAccountId: string): ChallengeResult {
  const serverKp = resolveServerKeypair();
  const networkPassphrase = resolveNetworkPassphrase();
  const homeDomain = resolveHomeDomain();
  const webAuthDomain = resolveWebAuthDomain();

  const transaction = WebAuth.buildChallengeTx(
    serverKp,
    clientAccountId,
    homeDomain,
    CHALLENGE_TTL_SECONDS,
    networkPassphrase,
    webAuthDomain
  );

  logger.debug(
    { clientAccountId, homeDomain },
    "SEP-10 challenge issued"
  );

  return { transaction, network_passphrase: networkPassphrase };
}

export interface VerifyResult {
  /** Stellar public key that signed the challenge. */
  accountId: string;
  /** Short-lived JWT for subsequent API calls. */
  token: string;
}

/**
 * Verifies a signed SEP-10 challenge and issues a JWT on success.
 *
 * @param signedXdr  Base64 XDR of the challenge transaction signed by the client.
 * @param accountId  The Stellar account the client claims to be.
 * @returns  `{ accountId, token }` on success.
 * @throws   An Error with a descriptive message on any failure.
 */
export function verifyChallenge(signedXdr: string, accountId: string): VerifyResult {
  const serverKp = resolveServerKeypair();
  const networkPassphrase = resolveNetworkPassphrase();
  const homeDomain = resolveHomeDomain();
  const webAuthDomain = resolveWebAuthDomain();

  // Read and validate challenge structure + server signature.
  let readResult: ReturnType<typeof WebAuth.readChallengeTx>;
  try {
    readResult = WebAuth.readChallengeTx(
      signedXdr,
      serverKp.publicKey(),
      networkPassphrase,
      homeDomain,
      webAuthDomain
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid SEP-10 challenge: ${msg}`);
  }

  // Confirm the account embedded in the challenge matches the claimed account.
  if (readResult.clientAccountID !== accountId) {
    throw new Error("Challenge account does not match the claimed account.");
  }

  // Replay-attack prevention.
  pruneUsedChallenges();
  const challengeNonce = deriveChallengeNonce(signedXdr);
  if (isChallengeAlreadyUsed(challengeNonce)) {
    throw new Error("Challenge has already been used (replay attack detected).");
  }

  // Verify the client has signed the challenge with the claimed key.
  let verified: string[];
  try {
    verified = WebAuth.verifyChallengeTxSigners(
      signedXdr,
      serverKp.publicKey(),
      networkPassphrase,
      [accountId],
      homeDomain,
      webAuthDomain
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Challenge signature verification failed: ${msg}`);
  }

  if (!verified.includes(accountId)) {
    throw new Error("Challenge was not signed by the claimed account.");
  }

  // Mark used to prevent replay attacks.
  markChallengeUsed(challengeNonce);

  const now = Math.floor(Date.now() / 1000);
  const jwtPayload: JwtPayload = {
    sub: accountId,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  };

  const token = signJwt(jwtPayload);

  logger.info({ accountId }, "SEP-10 authentication successful");

  return { accountId, token };
}

/** Clear the replay cache — only intended for use in tests. */
export function _clearUsedChallenges(): void {
  usedChallenges.clear();
}
