import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-api-report-${randomUUID()}.json`);
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
  for (const suffix of [".audit.json", ".reports.json"]) {
    try {
      fs.unlinkSync(storeFile.replace(/\.json$/i, suffix));
    } catch {
      /* best-effort */
    }
  }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

async function seedBounty(app: Express.Application): Promise<string> {
  const res = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
  return res.body.data.id as string;
}

describe("POST /api/bounties/:id/report", () => {
  it("records a report with the entered reason and returns it", async () => {
    const app = await getApp();
    const id = await seedBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/report`)
      .send({ reason: "This bounty looks like it asks for unpaid work." })
      .expect(201);

    expect(res.body.data.bountyId).toBe(id);
    expect(res.body.data.reason).toBe("This bounty looks like it asks for unpaid work.");
    expect(res.body.data.id).toMatch(/^RPT-/);
    expect(res.body.data.reportedAt).toBeGreaterThan(0);
  });

  it("rejects a report without a reason", async () => {
    const app = await getApp();
    const id = await seedBounty(app);

    const res = await request(app).post(`/api/bounties/${id}/report`).send({}).expect(400);
    expect(res.body.error).toBeDefined();
  });

  it("rejects a reason that is too long", async () => {
    const app = await getApp();
    const id = await seedBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/report`)
      .send({ reason: "x".repeat(501) })
      .expect(400);
    expect(res.body.error).toBeDefined();
  });

  it("rejects an empty (whitespace-only) reason", async () => {
    const app = await getApp();
    const id = await seedBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/report`)
      .send({ reason: "   " })
      .expect(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 for an unknown bounty id", async () => {
    const app = await getApp();

    const res = await request(app)
      .post("/api/bounties/BNT-9999/report")
      .send({ reason: "This bounty does not exist." })
      .expect(400);

    expect(res.body.error).toMatch(/not found/i);
  });

  it("appends a report transition to the bounty audit log", async () => {
    const app = await getApp();
    const id = await seedBounty(app);

    await request(app)
      .post(`/api/bounties/${id}/report`)
      .send({ reason: "Suspicious payout instructions." })
      .expect(201);

    const auditRes = await request(app)
      .get(`/api/bounties/${id}/audit-logs`)
      .query({ limit: 10, offset: 0 })
      .expect(200);
    const reportEntry = auditRes.body.data.find(
      (entry: { transition: string }) => entry.transition === "report",
    );
    expect(reportEntry).toBeDefined();
    expect(reportEntry.metadata.reason).toBe("Suspicious payout instructions.");
  });
});
