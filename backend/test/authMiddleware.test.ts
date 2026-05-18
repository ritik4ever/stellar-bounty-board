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

function signJsonPayload(payload: unknown): string {
  const message = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = signingKeypair.sign(message);
  return signature.toString("base64");
}

describe("Stellar auth middleware", () => {
  it("returns 401 when Stellar signature headers are missing", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send({
      repo: "owner/repo",
      issueNumber: 123,
      title: "Test bounty",
      summary: "Add test coverage to ensure auth middleware rejects unsigned requests.",
      maintainer: validMaintainerPublicKey,
      tokenSymbol: "XLM",
      amount: 10,
      deadlineDays: 14,
    }).expect(201);

    const id = created.data.id as string;

    const res = await request(app)
      .post(`/api/bounties/${id}/release`)
      .send({ maintainer: validMaintainerPublicKey, transactionHash: "a".repeat(64) })
      .expect(401);

    expect(res.body.error).toMatch(/missing.*signature|unauthorized/i);
  });

  it("allows release when Stellar payload is signed by the configured maintainer key", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send({
      repo: "owner/repo",
      issueNumber: 123,
      title: "Test bounty",
      summary: "Confirm signed release payload passes auth middleware.",
      maintainer: validMaintainerPublicKey,
      tokenSymbol: "XLM",
      amount: 10,
      deadlineDays: 14,
    }).expect(201);

    const id = created.data.id as string;

    await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: validMaintainerPublicKey }).expect(200);
    await request(app)
      .post(`/api/bounties/${id}/submit`)
      .send({ contributor: validMaintainerPublicKey, submissionUrl: "https://github.com/owner/repo/pull/1" })
      .expect(200);

    const payload = { maintainer: validMaintainerPublicKey, transactionHash: "a".repeat(64) };
    const signature = signJsonPayload(payload);

    const res = await request(app)
      .post(`/api/bounties/${id}/release`)
      .set("X-Stellar-Public-Key", validMaintainerPublicKey)
      .set("X-Stellar-Signature", signature)
      .send(payload)
      .expect(200);

    expect(res.body.data.status).toBe("released");
  });
});
