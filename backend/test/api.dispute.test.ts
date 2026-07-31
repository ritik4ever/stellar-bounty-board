import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER, OTHER_ACCOUNT, validCreateBody } from "./fixtures";

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
    const eventsRes = await request(app).get(`/api/bounties/${id}/events`).expect(200);
    const disputedEvent = eventsRes.body.data.find(
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