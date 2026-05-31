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
const otherKeypair = Keypair.random();

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

function validCreatePayload(summary: string) {
  return {
    repo: "owner/repo",
    issueNumber: 123,
    title: "Test bounty",
    summary,
    maintainer: validMaintainerPublicKey,
    tokenSymbol: "XLM",
    amount: 10,
    deadlineDays: 14,
  };
}

function createBountySignature(payload: ReturnType<typeof validCreatePayload>, keypair = signingKeypair): string {
  const signedPayload = {
    repo: payload.repo,
    issueNumber: payload.issueNumber,
    amount: payload.amount,
    tokenSymbol: payload.tokenSymbol,
    deadline: payload.deadlineDays,
  };
  return keypair.sign(Buffer.from(JSON.stringify(signedPayload), "utf8")).toString("base64");
}

describe("Stellar auth middleware", () => {
  it("returns 401 when create bounty is missing a Stellar signature", async () => {
    const app = await getApp();
    const payload = validCreatePayload("Unsigned create requests must not be allowed to spoof maintainers.");

    const res = await request(app).post("/api/bounties").send(payload).expect(401);

    expect(res.body.error).toMatch(/missing.*x-stellar-signature/i);
  });

  it("returns 401 when create bounty signer does not match maintainer", async () => {
    const app = await getApp();
    const payload = validCreatePayload("A different signer cannot create a bounty for this maintainer.");

    const res = await request(app)
      .post("/api/bounties")
      .set("X-Stellar-Signature", createBountySignature(payload, otherKeypair))
      .send(payload)
      .expect(401);

    expect(res.body.error).toMatch(/invalid.*signature|maintainer/i);
  });

  it("allows create bounty when the maintainer signs the required payload", async () => {
    const app = await getApp();
    const payload = validCreatePayload("The maintainer signed the issue bounty creation payload.");

    const res = await request(app)
      .post("/api/bounties")
      .set("X-Stellar-Signature", createBountySignature(payload))
      .send(payload)
      .expect(201);

    expect(res.body.data.maintainer).toBe(validMaintainerPublicKey);
    expect(res.body.data.issueNumber).toBe(payload.issueNumber);
  });

  it("returns 401 when Stellar signature headers are missing", async () => {
    const app = await getApp();
    const createPayload = validCreatePayload("Add test coverage to ensure auth middleware rejects unsigned requests.");
    const { body: created } = await request(app)
      .post("/api/bounties")
      .set("X-Stellar-Signature", createBountySignature(createPayload))
      .send(createPayload)
      .expect(201);

    const id = created.data.id as string;

    const res = await request(app)
      .post(`/api/bounties/${id}/release`)
      .send({ maintainer: validMaintainerPublicKey, transactionHash: "a".repeat(64) })
      .expect(401);

    expect(res.body.error).toMatch(/missing.*signature|unauthorized/i);
  });

  it("allows release when Stellar payload is signed by the configured maintainer key", async () => {
    const app = await getApp();
    const createPayload = validCreatePayload("Confirm signed release payload passes auth middleware.");
    const { body: created } = await request(app)
      .post("/api/bounties")
      .set("X-Stellar-Signature", createBountySignature(createPayload))
      .send(createPayload)
      .expect(201);

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
