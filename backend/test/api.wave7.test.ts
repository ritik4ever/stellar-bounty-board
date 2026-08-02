import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER, validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-wave-7-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  process.env.NODE_ENV = "test";
  process.env.ADMIN_API_KEY_HASH = "$2b$04$j5phs7Nrj/0eGbGIcCoureSw4QBbyXzmFO5wJKNAqBjpN1Scs/8Mq";
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.NOTIFICATION_CHANNEL;
  delete process.env.NOTIFICATION_WEBHOOK_URL;
  delete process.env.ADMIN_API_KEY_HASH;
  process.env.NODE_ENV = "test";
  for (const file of [storeFile, storeFile.replace(/\.json$/i, ".audit.json")]) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* best-effort cleanup */
    }
  }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

async function createBounty(app: Awaited<ReturnType<typeof getApp>>) {
  const response = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
  return response.body.data;
}

describe("Wave 7 bounty endpoints", () => {
  it("requires idempotency and returns independent bulk outcomes", async () => {
    const app = await getApp();
    const bounty = await createBounty(app);

    await request(app)
      .post("/api/bounties/bulk-action")
      .send({ bountyIds: [bounty.id], action: "refund", maintainer: MAINTAINER })
      .expect(400);

    const response = await request(app)
      .post("/api/bounties/bulk-action")
      .set("Idempotency-Key", "bulk-wave-7")
      .send({
        bountyIds: [bounty.id, "missing-bounty"],
        action: "refund",
        maintainer: MAINTAINER,
      })
      .expect(200);

    expect(response.body.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bountyId: bounty.id, success: true }),
        expect.objectContaining({ bountyId: "missing-bounty", success: false }),
      ]),
    );
  });

  it("returns 403 for bulk actions without admin authentication", async () => {
    const app = await getApp();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      await request(app)
        .post("/api/bounties/bulk-action")
        .set("Idempotency-Key", "bulk-wave-7-auth")
        .send({ bountyIds: ["missing-bounty"], action: "refund", maintainer: MAINTAINER })
        .expect(403);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("merges contract, audit, and notification records in timeline order", async () => {
    process.env.NOTIFICATION_CHANNEL = "WEBHOOK";
    const app = await getApp();
    const bounty = await createBounty(app);
    const githubFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ body: "Closes #99" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    try {
      await request(app)
        .post(`/api/bounties/${bounty.id}/reserve`)
        .set("Idempotency-Key", "reserve-wave-7")
        .send({ contributor: CONTRIBUTOR })
        .expect(200);
      await request(app)
        .post(`/api/bounties/${bounty.id}/submit`)
        .set("Idempotency-Key", "submit-wave-7")
        .send({
          contributor: CONTRIBUTOR,
          submissionUrl: "https://github.com/owner/repo-name/pull/1",
        })
        .expect(200);

      const response = await request(app).get(`/api/bounties/${bounty.id}/timeline`).expect(200);
      const entries = response.body.data;

      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: "contract", type: "created" }),
        expect.objectContaining({ source: "audit", type: "reserve" }),
        expect.objectContaining({ source: "notification", type: "bounty_reserved" }),
      ]));
      expect(entries).toEqual(
        [...entries].sort(
          (left: { timestamp: number; id: string }, right: { timestamp: number; id: string }) =>
            left.timestamp - right.timestamp || left.id.localeCompare(right.id),
        ),
      );
    } finally {
      githubFetch.mockRestore();
    }
  });

  it("exports filtered audit logs as CSV and JSON", async () => {
    const app = await getApp();
    const bounty = await createBounty(app);
    await request(app)
      .post(`/api/bounties/${bounty.id}/reserve`)
      .set("Idempotency-Key", "reserve-wave-7-export")
      .send({ contributor: CONTRIBUTOR })
      .expect(200);

    const csv = await request(app)
      .get("/api/audit-log/export.csv")
      .query({ from: new Date(Date.now() - 60_000).toISOString() })
      .expect(200);
    expect(csv.text).toContain("id,bounty_id,from_status,to_status,transition,actor,timestamp,metadata");
    expect(csv.text).toContain(`${bounty.id},open,reserved,reserve`);

    const json = await request(app).get("/api/audit-log/export.json").expect(200);
    expect(json.body.total).toBeGreaterThanOrEqual(1);
    expect(json.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ bountyId: bounty.id, transition: "reserve" })]),
    );
  });

  it("protects audit exports with admin authentication", async () => {
    const app = await getApp();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      await request(app).get("/api/audit-log/export.csv").expect(403);
      await request(app).get("/api/audit-log/export.json").expect(403);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
