import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storeFile: string;
const signingKeypair = Keypair.random();
const validMaintainerPublicKey = signingKeypair.publicKey();

const mismatchedKeypair = Keypair.random();

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-auth-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  process.env.NODE_ENV = "production";
  process.env.MAINTAINER_PUBLIC_KEY = validMaintainerPublicKey;
  // Required for SEP-10 JWT auth in production mode
  process.env.SERVER_SIGNING_SECRET = "SB6AAXPJJ4PXNRASQRTM4PDVJ6BVZLE6DP5AHV5E4KZ3CTJD5T6MOBB2";
  process.env.JWT_SECRET = "test-jwt-secret-for-production-mode-tests-32b";
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.NODE_ENV;
  delete process.env.MAINTAINER_PUBLIC_KEY;
  delete process.env.SERVER_SIGNING_SECRET;
  delete process.env.JWT_SECRET;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* best-effort */
  }
  try {
    const auditStorePath = storeFile.replace(/\.json$/i, ".audit.json");
    fs.unlinkSync(auditStorePath);
  } catch {
    /* best-effort */
  }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

function signPayload(keypair: Keypair, payload: unknown): string {
  const message = Buffer.from(JSON.stringify(payload), "utf8");
  return keypair.sign(message).toString("base64");
}

function bountyCreationCanonical(body: {
  repo: string;
  issueNumber: number;
  amount: number;
  tokenSymbol: string;
  deadlineDays: number;
}) {
  return {
    repo: body.repo,
    issueNumber: body.issueNumber,
    amount: body.amount,
    tokenSymbol: body.tokenSymbol,
    deadline: body.deadlineDays,
  };
}

const baseCreateBody = {
  repo: "owner/repo",
  issueNumber: 123,
  title: "Test bounty",
  summary: "Add test coverage to ensure auth middleware rejects unsigned requests.",
  maintainer: validMaintainerPublicKey,
  tokenSymbol: "XLM",
  amount: 10,
  deadlineDays: 14,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createSignedBounty(app: any) {
  const canonical = bountyCreationCanonical(baseCreateBody);
  const signature = signPayload(signingKeypair, canonical);
  const { body } = await request(app)
    .post("/api/bounties")
    .set("X-Stellar-Signature", signature)
    .send({ ...baseCreateBody, maintainer: validMaintainerPublicKey })
    .expect(201);
  return body.data.id as string;
}

describe("POST /api/bounties — Stellar signature requirement (#366)", () => {
  it("returns 401 when x-stellar-signature header is missing", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties")
      .send(baseCreateBody)
      .expect(401);
    expect(res.body.error).toMatch(/missing.*x-stellar-signature/i);
  });

  it("returns 401 when signature is signed by a key that does not match maintainer", async () => {
    const app = await getApp();
    const canonical = bountyCreationCanonical(baseCreateBody);
    // Signed by mismatchedKeypair, but maintainer in body is validMaintainerPublicKey
    const signature = signPayload(mismatchedKeypair, canonical);
    const res = await request(app)
      .post("/api/bounties")
      .set("X-Stellar-Signature", signature)
      .send(baseCreateBody)
      .expect(401);
    expect(res.body.error).toMatch(/invalid.*signature|signer.*maintainer/i);
  });

  it("creates bounty when signer public key matches maintainer address", async () => {
    const app = await getApp();
    const canonical = bountyCreationCanonical(baseCreateBody);
    const signature = signPayload(signingKeypair, canonical);
    const res = await request(app)
      .post("/api/bounties")
      .set("X-Stellar-Signature", signature)
      .send(baseCreateBody)
      .expect(201);
    expect(res.body.data.status).toBe("open");
    expect(res.body.data.maintainer).toBe(validMaintainerPublicKey);
  });
});

describe("Stellar auth middleware — release/refund routes (SEP-10 JWT)", () => {
  it("returns 401 when Authorization header is missing on release", async () => {
    const app = await getApp();
    const id = await createSignedBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/release`)
      .send({ maintainer: validMaintainerPublicKey, transactionHash: "a".repeat(64) })
      .expect(401);

    expect(res.body.error).toMatch(/authorization|bearer/i);
  });

  it("allows a valid JWT to pass the auth gate (reaches route handler, not 401)", async () => {
    const app = await getApp();

    // Produce a valid JWT for the maintainer
    const { signJwt, JWT_TTL_SECONDS } = await import("../src/services/sep10Auth");
    const now = Math.floor(Date.now() / 1000);
    const jwtSecret = Buffer.from("test-jwt-secret-for-production-mode-tests-32b", "utf8");
    const token = signJwt({
      sub: validMaintainerPublicKey,
      iat: now,
      exp: now + JWT_TTL_SECONDS,
    }, jwtSecret);

    // Use a non-existent bounty ID — the route will 404/400 but NOT 401,
    // which confirms the auth gate was passed successfully.
    const res = await request(app)
      .post("/api/bounties/nonexistent-bounty/release")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send({
        maintainer: validMaintainerPublicKey,
        transactionHash: "a".repeat(64),
      });

    // Auth passed — should be 400 or 404 (not found / validation), never 401
    expect(res.status).not.toBe(401);
  });

  it("rejects release when JWT is expired", async () => {
    const app = await getApp();
    const id = await createSignedBounty(app);

    const { signJwt } = await import("../src/services/sep10Auth");
    const past = Math.floor(Date.now() / 1000) - 7200;
    const jwtSecret = Buffer.from("test-jwt-secret-for-production-mode-tests-32b", "utf8");
    const expiredToken = signJwt({
      sub: validMaintainerPublicKey,
      iat: past,
      exp: past + 3600,
    }, jwtSecret);

    const res = await request(app)
      .post(`/api/bounties/${id}/release`)
      .set("Authorization", `Bearer ${expiredToken}`)
      .send({ maintainer: validMaintainerPublicKey, transactionHash: "a".repeat(64) })
      .expect(401);

    expect(res.body.error).toMatch(/expired/i);
  });

  it("rejects release when JWT has an invalid signature (tampered)", async () => {
    const app = await getApp();
    const id = await createSignedBounty(app);

    const { signJwt, JWT_TTL_SECONDS } = await import("../src/services/sep10Auth");
    const now = Math.floor(Date.now() / 1000);
    const jwtSecret = Buffer.from("test-jwt-secret-for-production-mode-tests-32b", "utf8");
    const token = signJwt({
      sub: validMaintainerPublicKey,
      iat: now,
      exp: now + JWT_TTL_SECONDS,
    }, jwtSecret);

    // Tamper with the last 4 characters of the token
    const tamperedToken = token.slice(0, -4) + "XXXX";

    const res = await request(app)
      .post(`/api/bounties/${id}/release`)
      .set("Authorization", `Bearer ${tamperedToken}`)
      .send({ maintainer: validMaintainerPublicKey, transactionHash: "a".repeat(64) })
      .expect(401);

    expect(res.body.error).toMatch(/signature|JWT/i);
  });
});
