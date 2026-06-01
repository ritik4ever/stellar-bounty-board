import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Keypair } from "stellar-sdk";
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
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.NODE_ENV;
  delete process.env.MAINTAINER_PUBLIC_KEY;
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

describe("Stellar auth middleware — release/refund routes", () => {
  it("returns 401 when Stellar signature headers are missing on release", async () => {
    const app = await getApp();
    const id = await createSignedBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/release`)
      .send({ maintainer: validMaintainerPublicKey, transactionHash: "a".repeat(64) })
      .expect(401);

    expect(res.body.error).toMatch(/missing.*signature|unauthorized/i);
  });

  it("allows release when Stellar payload is signed by the configured maintainer key", async () => {
    const app = await getApp();
    const id = await createSignedBounty(app);

    await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: validMaintainerPublicKey }).expect(200);
    await request(app)
      .post(`/api/bounties/${id}/submit`)
      .send({ contributor: validMaintainerPublicKey, submissionUrl: "https://example.com/pr/1" })
      .expect(200);

    const payload = { maintainer: validMaintainerPublicKey, transactionHash: "a".repeat(64) };
    const signature = signPayload(signingKeypair, payload);

    const res = await request(app)
      .post(`/api/bounties/${id}/release`)
      .set("X-Stellar-Public-Key", validMaintainerPublicKey)
      .set("X-Stellar-Signature", signature)
      .send(payload)
      .expect(200);

    expect(res.body.data.status).toBe("released");
  });
});
