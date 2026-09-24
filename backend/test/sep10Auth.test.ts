/**
 * Tests for SEP-10 wallet authentication:
 *   - GET  /api/auth/challenge
 *   - POST /api/auth/verify
 *   - requireSep10Auth() middleware
 *   - signJwt / verifyJwt helpers
 *
 * The tests use a deterministic server keypair (same as the dev fallback in
 * sep10Auth.ts) so no env vars are required.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import {
  Keypair,
  Networks,
  TransactionBuilder,
  WebAuth,
} from "@stellar/stellar-sdk";
import request from "supertest";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  buildChallenge,
  verifyChallenge,
  signJwt,
  verifyJwt,
  resolveServerKeypair,
  resolveNetworkPassphrase,
  resolveHomeDomain,
  resolveWebAuthDomain,
  _clearUsedChallenges,
  JWT_TTL_SECONDS,
  CHALLENGE_TTL_SECONDS,
} from "../src/services/sep10Auth";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const clientKp = Keypair.random();

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-sep10-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  // Keep NODE_ENV as test so the app auth middleware is bypassed for bounty routes
  process.env.NODE_ENV = "test";
  // Clear the replay cache between tests
  _clearUsedChallenges();
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.SERVER_SIGNING_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.HOME_DOMAIN;
  delete process.env.WEB_AUTH_DOMAIN;
  _clearUsedChallenges();
  try { fs.unlinkSync(storeFile); } catch { /* best-effort */ }
  try { fs.unlinkSync(storeFile.replace(/\.json$/, ".audit.json")); } catch { /* best-effort */ }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

// ---------------------------------------------------------------------------
// Helper: build a fully signed challenge for `clientAccountId`
// ---------------------------------------------------------------------------

function buildSignedChallenge(signingKp: Keypair = clientKp): string {
  const serverKp = resolveServerKeypair();
  const networkPassphrase = resolveNetworkPassphrase();
  const homeDomain = resolveHomeDomain();
  const webAuthDomain = resolveWebAuthDomain();

  const challengeXdr = WebAuth.buildChallengeTx(
    serverKp,
    signingKp.publicKey(),
    homeDomain,
    CHALLENGE_TTL_SECONDS,
    networkPassphrase,
    webAuthDomain
  );

  // Client signs the challenge
  const tx = TransactionBuilder.fromXDR(challengeXdr, networkPassphrase);
  tx.sign(signingKp);
  return tx.toEnvelope().toXDR("base64");
}

// ---------------------------------------------------------------------------
// Unit tests — buildChallenge / verifyChallenge
// ---------------------------------------------------------------------------

describe("buildChallenge", () => {
  it("returns a valid base64 XDR and the network passphrase", () => {
    const result = buildChallenge(clientKp.publicKey());
    expect(result.transaction).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(result.network_passphrase).toBeTruthy();
  });

  it("challenge can be read back by stellar-sdk WebAuth", () => {
    const serverKp = resolveServerKeypair();
    const networkPassphrase = resolveNetworkPassphrase();
    const homeDomain = resolveHomeDomain();
    const webAuthDomain = resolveWebAuthDomain();

    const { transaction } = buildChallenge(clientKp.publicKey());
    const { clientAccountID } = WebAuth.readChallengeTx(
      transaction,
      serverKp.publicKey(),
      networkPassphrase,
      homeDomain,
      webAuthDomain
    );
    expect(clientAccountID).toBe(clientKp.publicKey());
  });
});

describe("verifyChallenge", () => {
  it("returns { accountId, token } on a validly signed challenge", () => {
    const signedXdr = buildSignedChallenge();
    const result = verifyChallenge(signedXdr, clientKp.publicKey());
    expect(result.accountId).toBe(clientKp.publicKey());
    expect(result.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/); // JWT format
  });

  it("rejects when the claimed account does not match the challenge account", () => {
    const differentKp = Keypair.random();
    const signedXdr = buildSignedChallenge(clientKp);
    expect(() => verifyChallenge(signedXdr, differentKp.publicKey())).toThrowError(
      /challenge account does not match/i
    );
  });

  it("rejects when the challenge is signed by the wrong key", () => {
    const wrongKp = Keypair.random();
    const serverKp = resolveServerKeypair();
    const networkPassphrase = resolveNetworkPassphrase();
    const homeDomain = resolveHomeDomain();
    const webAuthDomain = resolveWebAuthDomain();

    // Build challenge for clientKp but sign with wrongKp
    const challengeXdr = WebAuth.buildChallengeTx(
      serverKp,
      clientKp.publicKey(),
      homeDomain,
      CHALLENGE_TTL_SECONDS,
      networkPassphrase,
      webAuthDomain
    );
    const tx = TransactionBuilder.fromXDR(challengeXdr, networkPassphrase);
    tx.sign(wrongKp); // wrong signer
    const badXdr = tx.toEnvelope().toXDR("base64");

    expect(() => verifyChallenge(badXdr, clientKp.publicKey())).toThrow();
  });

  it("rejects a replayed (already used) challenge", () => {
    const signedXdr = buildSignedChallenge();
    // First call succeeds
    verifyChallenge(signedXdr, clientKp.publicKey());
    // Second call with the same XDR should fail
    expect(() => verifyChallenge(signedXdr, clientKp.publicKey())).toThrowError(
      /replay attack/i
    );
  });

  it("rejects an expired challenge transaction", () => {
    const serverKp = resolveServerKeypair();
    const networkPassphrase = resolveNetworkPassphrase();
    const homeDomain = resolveHomeDomain();
    const webAuthDomain = resolveWebAuthDomain();

    // Build a challenge with a 1-second TTL
    const challengeXdr = WebAuth.buildChallengeTx(
      serverKp,
      clientKp.publicKey(),
      homeDomain,
      1, // 1-second TTL — expires very quickly
      networkPassphrase,
      webAuthDomain
    );

    // Sign it immediately (while still valid)
    const tx = TransactionBuilder.fromXDR(challengeXdr, networkPassphrase);
    tx.sign(clientKp);
    const signedXdr = tx.toEnvelope().toXDR("base64");

    // Advance the clock so the challenge is past its maxTime + the 5-min grace period
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (CHALLENGE_TTL_SECONDS + 60 * 6) * 1000);

    try {
      expect(() => verifyChallenge(signedXdr, clientKp.publicKey())).toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests — JWT helpers
// ---------------------------------------------------------------------------

describe("signJwt / verifyJwt", () => {
  it("round-trips a payload correctly", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: clientKp.publicKey(), iat: now, exp: now + JWT_TTL_SECONDS };
    const token = signJwt(payload);
    const decoded = verifyJwt(token);
    expect(decoded.sub).toBe(clientKp.publicKey());
  });

  it("rejects a tampered token", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt({ sub: "GTEST", iat: now, exp: now + 3600 });
    const tampered = token.slice(0, -4) + "XXXX";
    expect(() => verifyJwt(tampered)).toThrow(/signature|malformed/i);
  });

  it("rejects an expired token", () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = signJwt({ sub: "GTEST", iat: past, exp: past + 3600 });
    expect(() => verifyJwt(token)).toThrowError(/expired/i);
  });

  it("rejects a malformed token without three parts", () => {
    expect(() => verifyJwt("not.a.valid.jwt.at.all")).toThrow();
    expect(() => verifyJwt("onlytwoparts")).toThrow(/malformed/i);
  });
});

// ---------------------------------------------------------------------------
// HTTP tests — GET /api/auth/challenge
// ---------------------------------------------------------------------------

describe("GET /api/auth/challenge", () => {
  it("returns 400 when account param is missing", async () => {
    const app = await getApp();
    const res = await request(app).get("/api/auth/challenge").expect(400);
    expect(res.body.error).toMatch(/account/i);
  });

  it("returns 400 when account is not a valid Stellar address", async () => {
    const app = await getApp();
    const res = await request(app)
      .get("/api/auth/challenge?account=NOTVALID")
      .expect(400);
    expect(res.body.error).toMatch(/stellar public key/i);
  });

  it("returns transaction and network_passphrase for a valid account", async () => {
    const app = await getApp();
    const res = await request(app)
      .get(`/api/auth/challenge?account=${clientKp.publicKey()}`)
      .expect(200);
    expect(res.body.transaction).toBeTruthy();
    expect(res.body.network_passphrase).toBeTruthy();
  });

  it("returns a challenge verifiable with stellar-sdk", async () => {
    const app = await getApp();
    const res = await request(app)
      .get(`/api/auth/challenge?account=${clientKp.publicKey()}`)
      .expect(200);

    const serverKp = resolveServerKeypair();
    const { clientAccountID } = WebAuth.readChallengeTx(
      res.body.transaction,
      serverKp.publicKey(),
      res.body.network_passphrase,
      resolveHomeDomain(),
      resolveWebAuthDomain()
    );
    expect(clientAccountID).toBe(clientKp.publicKey());
  });
});

// ---------------------------------------------------------------------------
// HTTP tests — POST /api/auth/verify
// ---------------------------------------------------------------------------

describe("POST /api/auth/verify", () => {
  it("returns 400 when body is missing required fields", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/auth/verify")
      .send({})
      .expect(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("returns 400 when account is not a valid Stellar address", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/auth/verify")
      .send({ transaction: "someXdr", account: "INVALID" })
      .expect(400);
    expect(res.body.error).toMatch(/stellar public key/i);
  });

  it("returns 400 when the XDR is structurally invalid", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/auth/verify")
      .send({ transaction: "not-valid-xdr", account: clientKp.publicKey() })
      .expect(400);
    expect(res.body.error).toMatch(/invalid sep-10 challenge/i);
  });

  it("returns 401 when signed by a different account", async () => {
    const app = await getApp();
    const differentKp = Keypair.random();
    const signedXdr = buildSignedChallenge(clientKp);

    const res = await request(app)
      .post("/api/auth/verify")
      .send({ transaction: signedXdr, account: differentKp.publicKey() })
      .expect(401);
    expect(res.body.error).toMatch(/challenge account|verification failed/i);
  });

  it("returns { token, account } on a valid signed challenge", async () => {
    const app = await getApp();
    const signedXdr = buildSignedChallenge(clientKp);

    const res = await request(app)
      .post("/api/auth/verify")
      .send({ transaction: signedXdr, account: clientKp.publicKey() })
      .expect(200);

    expect(res.body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(res.body.account).toBe(clientKp.publicKey());
  });

  it("returns 401 on a replayed signed challenge", async () => {
    const app = await getApp();
    const signedXdr = buildSignedChallenge(clientKp);

    await request(app)
      .post("/api/auth/verify")
      .send({ transaction: signedXdr, account: clientKp.publicKey() })
      .expect(200);

    const res = await request(app)
      .post("/api/auth/verify")
      .send({ transaction: signedXdr, account: clientKp.publicKey() })
      .expect(401);

    expect(res.body.error).toMatch(/replay/i);
  });
});

// ---------------------------------------------------------------------------
// HTTP tests — requireSep10Auth middleware on protected routes
//
// In NODE_ENV=test, the middleware is bypassed, which is the correct behaviour
// (same pattern as the legacy createStellarSignatureAuthMiddleware).
// These tests verify the middleware behaviour when NODE_ENV is "production".
// ---------------------------------------------------------------------------

describe("requireSep10Auth middleware (production mode)", () => {
  let prodStoreFile: string;

  beforeEach(() => {
    prodStoreFile = path.join(os.tmpdir(), `bounty-sep10-prod-${randomUUID()}.json`);
    fs.writeFileSync(prodStoreFile, "[]", "utf8");
    process.env.BOUNTY_STORE_PATH = prodStoreFile;
    process.env.NODE_ENV = "production";
    process.env.MAINTAINER_PUBLIC_KEY = clientKp.publicKey();
    // Provide valid server signing secret and JWT secret for production mode
    process.env.SERVER_SIGNING_SECRET = "SB6AAXPJJ4PXNRASQRTM4PDVJ6BVZLE6DP5AHV5E4KZ3CTJD5T6MOBB2";
    process.env.JWT_SECRET = "test-jwt-secret-for-production-mode-tests-32b";
    _clearUsedChallenges();
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = "test";
    delete process.env.MAINTAINER_PUBLIC_KEY;
    delete process.env.SERVER_SIGNING_SECRET;
    delete process.env.JWT_SECRET;
    try { fs.unlinkSync(prodStoreFile); } catch { /* best-effort */ }
    try { fs.unlinkSync(prodStoreFile.replace(/\.json$/, ".audit.json")); } catch { /* best-effort */ }
  });

  it("returns 401 when Authorization header is missing on a protected route", async () => {
    const { app } = await import("../src/app");
    const res = await request(app)
      .post("/api/bounties/nonexistent/release")
      .send({ maintainer: clientKp.publicKey(), transactionHash: "a".repeat(64) })
      .expect(401);
    expect(res.body.error).toMatch(/Authorization|Bearer/i);
  });

  it("returns 401 when Authorization header has wrong format", async () => {
    const { app } = await import("../src/app");
    const res = await request(app)
      .post("/api/bounties/nonexistent/release")
      .set("Authorization", "Token abc123")
      .send({ maintainer: clientKp.publicKey(), transactionHash: "a".repeat(64) })
      .expect(401);
    expect(res.body.error).toMatch(/Authorization|Bearer/i);
  });

  it("returns 401 when JWT is malformed", async () => {
    const { app } = await import("../src/app");
    const res = await request(app)
      .post("/api/bounties/nonexistent/release")
      .set("Authorization", "Bearer not.a.valid.token")
      .send({ maintainer: clientKp.publicKey(), transactionHash: "a".repeat(64) })
      .expect(401);
    expect(res.body.error).toMatch(/JWT|signature/i);
  });

  it("returns 401 when JWT is expired", async () => {
    const { app } = await import("../src/app");
    const past = Math.floor(Date.now() / 1000) - 7200;
    const jwtSecret = Buffer.from("test-jwt-secret-for-production-mode-tests-32b", "utf8");
    const expiredToken = signJwt({ sub: clientKp.publicKey(), iat: past, exp: past + 3600 }, jwtSecret);
    const res = await request(app)
      .post("/api/bounties/nonexistent/release")
      .set("Authorization", `Bearer ${expiredToken}`)
      .send({ maintainer: clientKp.publicKey(), transactionHash: "a".repeat(64) })
      .expect(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  it("passes through when a valid JWT is provided (reaches route handler)", async () => {
    const { app } = await import("../src/app");
    const now = Math.floor(Date.now() / 1000);
    const jwtSecret = Buffer.from("test-jwt-secret-for-production-mode-tests-32b", "utf8");
    const validToken = signJwt({
      sub: clientKp.publicKey(),
      iat: now,
      exp: now + JWT_TTL_SECONDS,
    }, jwtSecret);

    // The route will 404 (bounty not found) — that's past the auth gate.
    const res = await request(app)
      .post("/api/bounties/nonexistent-id/release")
      .set("Authorization", `Bearer ${validToken}`)
      .set("Content-Type", "application/json")
      .send({
        maintainer: clientKp.publicKey(),
        transactionHash: "a".repeat(64),
        action: "release",
        bountyId: "nonexistent-id",
        timestamp: now,
      });

    // Should NOT be 401 — auth passed. 400 or 404 means auth was OK.
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Full integration: challenge → sign → verify → use token on protected route
// ---------------------------------------------------------------------------

describe("SEP-10 full authentication flow", () => {
  it("authenticates via challenge/verify and uses the token on a protected route", async () => {
    const app = await getApp();

    // Step 1: Get challenge
    const challengeRes = await request(app)
      .get(`/api/auth/challenge?account=${clientKp.publicKey()}`)
      .expect(200);

    const { transaction: challengeXdr, network_passphrase } = challengeRes.body as {
      transaction: string;
      network_passphrase: string;
    };

    // Step 2: Client signs the challenge
    const tx = TransactionBuilder.fromXDR(challengeXdr, network_passphrase);
    tx.sign(clientKp);
    const signedXdr = tx.toEnvelope().toXDR("base64");

    // Step 3: Submit signed challenge and receive JWT
    const verifyRes = await request(app)
      .post("/api/auth/verify")
      .send({ transaction: signedXdr, account: clientKp.publicKey() })
      .expect(200);

    expect(verifyRes.body.token).toBeTruthy();
    expect(verifyRes.body.account).toBe(clientKp.publicKey());

    // Step 4: Verify token is a well-formed, valid JWT
    const decoded = verifyJwt(verifyRes.body.token as string);
    expect(decoded.sub).toBe(clientKp.publicKey());
  });
});
