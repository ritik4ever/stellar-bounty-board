import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { Keypair } from "@stellar/stellar-sdk";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARBITER, CONTRIBUTOR, MAINTAINER, OTHER_ACCOUNT, validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-api-dispute-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  process.env.NODE_ENV = "test";
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
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

/**
 * Seed bounties through the store directly (bypass middleware) so we can test
 * the dispute route in isolation. Returns the bounty IDs in order.
 */
async function seedBounty(
  app: Express.Application,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const body = { ...validCreateBody, ...overrides };
  const res = await request(app).post("/api/bounties").send(body).expect(201);
  return res.body.data.id as string;
}

async function fullCycle(app: Express.Application): Promise<string> {
  const id = await seedBounty(app);
  await request(app)
    .post(`/api/bounties/${id}/reserve`)
    .send({ contributor: CONTRIBUTOR })
    .expect(200);
  await request(app)
    .post(`/api/bounties/${id}/submit`)
    .send({
      contributor: CONTRIBUTOR,
      submissionUrl: "https://github.com/owner/repo/pull/1",
    })
    .expect(200);
  return id;
}

async function disputedBounty(app: Express.Application): Promise<string> {
  const id = await fullCycle(app);
  await request(app)
    .post(`/api/bounties/${id}/dispute`)
    .send({ contributor: CONTRIBUTOR, reason: "Maintainer did not review within the agreed timeframe." })
    .expect(200);
  return id;
}

describe("POST /api/bounties/:id/dispute", () => {
  it("disputes a submitted bounty successfully", async () => {
    const app = await getApp();
    const id = await fullCycle(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/dispute`)
      .send({ contributor: CONTRIBUTOR, reason: "Maintainer did not review within the agreed timeframe." })
      .expect(200);

    expect(res.body.data.status).toBe("disputed");
    expect(res.body.data.disputeReason).toBe("Maintainer did not review within the agreed timeframe.");
    expect(res.body.data.disputedAt).toBeGreaterThan(0);
    expect(res.body.data.version).toBeGreaterThan(1);

    // Verify the event log contains the disputed event
    const disputedEvent = res.body.data.events.find(
      (e: { type: string }) => e.type === "disputed",
    );
    expect(disputedEvent).toBeDefined();
    expect(disputedEvent.actor).toBe(CONTRIBUTOR);
    expect(disputedEvent.details.reason).toBe("Maintainer did not review within the agreed timeframe.");

    // Verify audit log
    const auditRes = await request(app)
      .get(`/api/bounties/${id}/audit-logs`)
      .query({ limit: 10, offset: 0 })
      .expect(200);
    const disputeAudit = auditRes.body.data.find(
      (entry: { transition: string }) => entry.transition === "dispute",
    );
    expect(disputeAudit).toBeDefined();
    expect(disputeAudit.fromStatus).toBe("submitted");
    expect(disputeAudit.toStatus).toBe("disputed");
    expect(disputeAudit.actor).toBe(CONTRIBUTOR);
  });

  it("returns 400 when contributor does not match the bounty contributor", async () => {
    const app = await getApp();
    const id = await fullCycle(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/dispute`)
      .send({ contributor: OTHER_ACCOUNT, reason: "Not my bounty." })
      .expect(400);

    expect(res.body.error).toMatch(/Only the contributor/i);
  });

  it("returns 400 when bounty status is not submitted", async () => {
    const app = await getApp();
    const id = await seedBounty(app);

    // Bounty is 'open' - should fail
    const res = await request(app)
      .post(`/api/bounties/${id}/dispute`)
      .send({ contributor: MAINTAINER, reason: "Wrong status." })
      .expect(400);

    expect(res.body.error).toMatch(/Only submitted bounties can be disputed/i);
  });

  it("returns 400 when reason is empty", async () => {
    const app = await getApp();
    const id = await fullCycle(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/dispute`)
      .send({ contributor: CONTRIBUTOR, reason: "" })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it("returns 400 when contributor address is invalid", async () => {
    const app = await getApp();
    const id = await fullCycle(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/dispute`)
      .send({ contributor: "not-a-valid-address", reason: "Test reason." })
      .expect(400);

    expect(res.body.error).toMatch(/public key|Must be valid/i);
  });

  it("returns 400 for unknown bounty id", async () => {
    const app = await getApp();

    const res = await request(app)
      .post("/api/bounties/BNT-9999/dispute")
      .send({ contributor: CONTRIBUTOR, reason: "Bounty not found." })
      .expect(400);

    expect(res.body.error).toMatch(/not found/i);
  });
});

describe("POST /api/bounties/:id/resolve-dispute", () => {
  it("resolves a disputed bounty with release=true and records audit log", async () => {
    const app = await getApp();
    const id = await disputedBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/resolve-dispute`)
      .send({ arbiter: ARBITER, release: true, resolution_notes: "Work meets acceptance criteria." })
      .expect(200);

    expect(res.body.data.status).toBe("released");
    expect(res.body.data.releasedAt).toBeGreaterThan(0);
    expect(res.body.data.resolutionNotes).toBe("Work meets acceptance criteria.");

    const auditRes = await request(app)
      .get(`/api/bounties/${id}/audit-logs`)
      .query({ limit: 10, offset: 0 })
      .expect(200);

    expect(auditRes.body.data.map((entry: { transition: string }) => entry.transition)).toEqual([
      "reserve",
      "submit",
      "dispute",
      "release",
    ]);

    const resolveAudit = auditRes.body.data.find(
      (entry: { transition: string }) => entry.transition === "release",
    );
    expect(resolveAudit).toBeDefined();
    expect(resolveAudit.fromStatus).toBe("disputed");
    expect(resolveAudit.toStatus).toBe("released");
    expect(resolveAudit.actor).toBe(ARBITER);
    expect(resolveAudit.metadata.release).toBe(true);
  });

  it("resolves a disputed bounty with release=false and records audit log", async () => {
    const app = await getApp();
    const id = await disputedBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/resolve-dispute`)
      .send({ arbiter: ARBITER, release: false, resolution_notes: "Submission does not meet requirements." })
      .expect(200);

    expect(res.body.data.status).toBe("refunded");
    expect(res.body.data.refundedAt).toBeGreaterThan(0);
    expect(res.body.data.resolutionNotes).toBe("Submission does not meet requirements.");

    const auditRes = await request(app)
      .get(`/api/bounties/${id}/audit-logs`)
      .query({ limit: 10, offset: 0 })
      .expect(200);

    expect(auditRes.body.data.map((entry: { transition: string }) => entry.transition)).toEqual([
      "reserve",
      "submit",
      "dispute",
      "refund",
    ]);

    const resolveAudit = auditRes.body.data.find(
      (entry: { transition: string }) => entry.transition === "refund",
    );
    expect(resolveAudit).toBeDefined();
    expect(resolveAudit.fromStatus).toBe("disputed");
    expect(resolveAudit.toStatus).toBe("refunded");
    expect(resolveAudit.actor).toBe(ARBITER);
    expect(resolveAudit.metadata.release).toBe(false);
  });
});

describe("POST /api/bounties/:id/resolve-dispute — arbiter auth", () => {
  const arbiterKeypair = Keypair.random();
  const wrongKeypair = Keypair.random();

  function signPayload(keypair: Keypair, payload: unknown): string {
    const message = Buffer.from(JSON.stringify(payload), "utf8");
    return keypair.sign(message).toString("base64");
  }

  it("returns 401 when resolve-dispute is signed by a non-arbiter key", async () => {
    const app = await getApp();
    const id = await disputedBounty(app);

    process.env.NODE_ENV = "production";
    process.env.ARBITER_ADDRESS = arbiterKeypair.publicKey();

    const payload = {
      arbiter: wrongKeypair.publicKey(),
      release: true,
      action: "resolve-dispute",
      bountyId: id,
      timestamp: Math.floor(Date.now() / 1000),
    };
    const signature = signPayload(wrongKeypair, payload);

    const res = await request(app)
      .post(`/api/bounties/${id}/resolve-dispute`)
      .set("X-Stellar-Public-Key", wrongKeypair.publicKey())
      .set("X-Stellar-Signature", signature)
      .send(payload)
      .expect(401);

    expect(res.body.error).toMatch(/unauthorized/i);

    delete process.env.ARBITER_ADDRESS;
    process.env.NODE_ENV = "test";
  });
});