import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Keypair } from "stellar-sdk";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validCreateBody } from "./fixtures";

let storeFile: string;
let contributorKeypair: Keypair;
let arbiterKeypair: Keypair;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-dispute-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  contributorKeypair = Keypair.random();
  arbiterKeypair = Keypair.random();

  process.env.BOUNTY_STORE_PATH = storeFile;
  process.env.NODE_ENV = "production";
  process.env.ARBITER_ADDRESS = arbiterKeypair.publicKey();
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.NODE_ENV;
  delete process.env.ARBITER_ADDRESS;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* best-effort */
  }
  try {
    fs.unlinkSync(storeFile.replace(/\.json$/i, ".audit.json"));
  } catch {
    /* best-effort */
  }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

function signJsonPayload(keypair: Keypair, payload: unknown): string {
  return keypair.sign(Buffer.from(JSON.stringify(payload), "utf8")).toString("base64");
}

async function createSubmittedBounty(app: Awaited<ReturnType<typeof getApp>>) {
  const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
  const id = created.data.id as string;
  const contributor = contributorKeypair.publicKey();

  await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor }).expect(200);
  await request(app)
    .post(`/api/bounties/${id}/submit`)
    .send({
      contributor,
      submissionUrl: "https://github.com/owner/repo-name/pull/72",
      notes: "Ready for dispute flow verification.",
    })
    .expect(200);

  return { id, contributor };
}

function signedPost(
  app: Awaited<ReturnType<typeof getApp>>,
  url: string,
  keypair: Keypair,
  payload: Record<string, unknown>,
) {
  return request(app)
    .post(url)
    .set("X-Stellar-Public-Key", keypair.publicKey())
    .set("X-Stellar-Signature", signJsonPayload(keypair, payload))
    .send(payload);
}

describe("dispute and resolution flow", () => {
  it("lets the contributor dispute a submitted bounty and lets the arbiter release it", async () => {
    const app = await getApp();
    const { id, contributor } = await createSubmittedBounty(app);

    const disputePayload = { contributor, reason: "Submitted work meets the acceptance criteria." };
    const disputed = await signedPost(app, `/api/bounties/${id}/dispute`, contributorKeypair, disputePayload).expect(200);

    expect(disputed.body.data.status).toBe("disputed");
    expect(disputed.body.data.disputeReason).toBe(disputePayload.reason);
    expect(disputed.body.data.disputedAt).toEqual(expect.any(Number));

    const resolvePayload = {
      arbiter: arbiterKeypair.publicKey(),
      release: true,
      resolution_notes: "Evidence confirms the submission should be released.",
    };
    const resolved = await signedPost(app, `/api/bounties/${id}/resolve-dispute`, arbiterKeypair, resolvePayload).expect(200);

    expect(resolved.body.data.status).toBe("released");
    expect(resolved.body.data.resolutionNotes).toBe(resolvePayload.resolution_notes);

    const logs = await request(app).get(`/api/bounties/${id}/audit-logs`).query({ limit: 10 }).expect(200);
    expect(logs.body.data.map((entry: { transition: string }) => entry.transition)).toEqual([
      "reserve",
      "submit",
      "dispute",
      "release",
    ]);
    expect(logs.body.data.at(-1).metadata.resolution_notes).toBe(resolvePayload.resolution_notes);
  });

  it("lets the arbiter refund a disputed bounty", async () => {
    const app = await getApp();
    const { id, contributor } = await createSubmittedBounty(app);

    const disputePayload = { contributor, reason: "Submission does not match the requested implementation." };
    await signedPost(app, `/api/bounties/${id}/dispute`, contributorKeypair, disputePayload).expect(200);

    const resolvePayload = {
      arbiter: arbiterKeypair.publicKey(),
      release: false,
      resolution_notes: "Maintainer evidence shows the bounty should be refunded.",
    };
    const resolved = await signedPost(app, `/api/bounties/${id}/resolve-dispute`, arbiterKeypair, resolvePayload).expect(200);

    expect(resolved.body.data.status).toBe("refunded");
    expect(resolved.body.data.resolutionNotes).toBe(resolvePayload.resolution_notes);

    const logs = await request(app).get(`/api/bounties/${id}/audit-logs`).query({ limit: 10 }).expect(200);
    expect(logs.body.data.map((entry: { transition: string }) => entry.transition)).toEqual([
      "reserve",
      "submit",
      "dispute",
      "refund",
    ]);
  });

  it("rejects a resolve attempt signed by the wrong arbiter", async () => {
    const app = await getApp();
    const { id, contributor } = await createSubmittedBounty(app);

    const disputePayload = { contributor, reason: "Needs arbiter review." };
    await signedPost(app, `/api/bounties/${id}/dispute`, contributorKeypair, disputePayload).expect(200);

    const wrongArbiter = Keypair.random();
    const resolvePayload = {
      arbiter: wrongArbiter.publicKey(),
      release: true,
      resolution_notes: "Unauthorized decision.",
    };

    const res = await signedPost(app, `/api/bounties/${id}/resolve-dispute`, wrongArbiter, resolvePayload).expect(401);
    expect(res.body.error).toMatch(/unauthorized|arbiter/i);
  });
});
