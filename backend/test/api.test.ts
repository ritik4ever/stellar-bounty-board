import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER, OTHER_ACCOUNT, validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-api-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
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

describe("API — health and listing", () => {
  it("GET /api/health returns ok", async () => {
    const app = await getApp();
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toContain("bounty-board");
  });

  it("echoes a valid X-Request-ID response header", async () => {
    const app = await getApp();
    const res = await request(app).get("/api/health").set("X-Request-ID", "trace-123").expect(200);
    expect(res.headers["x-request-id"]).toBe("trace-123");
  });

  it("generates an X-Request-ID when the incoming header is invalid", async () => {
    const app = await getApp();
    const res = await request(app).get("/api/health").set("X-Request-ID", "bad id with spaces").expect(200);
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("includes the requestId from X-Request-ID in JSON error responses", async () => {
    const app = await getApp();
    const res = await request(app)
      .get("/api/bounties/released/export.csv")
      .query({ issueNumber: "not-a-number" })
      .set("X-Request-ID", "export-trace-1")
      .expect(400);
    expect(res.headers["x-request-id"]).toBe("export-trace-1");
    expect(res.body.requestId).toBe("export-trace-1");
    expect(res.body.error).toMatch(/issueNumber/i);
  });

  it("GET /api/bounties returns data array", async () => {
    const app = await getApp();
    const res = await request(app).get("/api/bounties").expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /api/open-issues returns data", async () => {
    const app = await getApp();
    const res = await request(app).get("/api/open-issues").expect(200);
    expect(res.body).toHaveProperty("data");
  });
});

describe("API — bounty lifecycle routes", () => {
  it("POST /api/bounties creates and GET lists it", async () => {
    const app = await getApp();
    const createRes = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = createRes.body.data.id as string;
    expect(createRes.body.data.status).toBe("open");

    const listRes = await request(app).get("/api/bounties").expect(200);
    expect(listRes.body.data.some((b: { id: string }) => b.id === id)).toBe(true);
  });

  it("POST create with invalid body returns 400", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties")
      .send({ repo: "bad", issueNumber: 0 })
      .expect(400);
    expect(res.body.error).toBeDefined();
  });

  it("POST create with amount below 1 XLM returns 400", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties")
      .send({ ...validCreateBody, amount: 0.5 })
      .expect(400);
    expect(res.body.error).toMatch(/at least 1 XLM/i);
  });

  it("POST create with amount above 10000 XLM returns 400", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties")
      .send({ ...validCreateBody, amount: 10001 })
      .expect(400);
    expect(res.body.error).toMatch(/exceed 10000 XLM/i);
  });

  it("POST create with more than 7 decimal places returns 400", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties")
      .send({ ...validCreateBody, amount: 100.12345678 })
      .expect(400);
    expect(res.body.error).toMatch(/at most 7 decimal places/i);
  });

  it("POST create with exactly 7 decimal places succeeds", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties")
      .send({ ...validCreateBody, amount: 100.1234567 })
      .expect(201);
    expect(res.body.data.id).toMatch(/^BNT-\d{4}$/);
  });

  it("POST create with 1 XLM succeeds", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties")
      .send({ ...validCreateBody, amount: 1 })
      .expect(201);
    expect(res.body.data.amount).toBe(1);
  });

  it("POST create with 10000 XLM succeeds", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties")
      .send({ ...validCreateBody, amount: 10000 })
      .expect(201);
    expect(res.body.data.amount).toBe(10000);
  });

  it("reserve → submit → release flow via HTTP", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    const txHash = "a".repeat(64);

    await request(app)
      .post(`/api/bounties/${id}/reserve`)
      .send({ contributor: CONTRIBUTOR })
      .expect(200);

    await request(app)
      .post(`/api/bounties/${id}/submit`)
      .send({
        contributor: CONTRIBUTOR,
        submissionUrl: "https://github.com/owner/repo-name/pull/1",
      })
      .expect(200);

    const rel = await request(app)
      .post(`/api/bounties/${id}/release`)
      .send({ maintainer: MAINTAINER, transactionHash: txHash })
      .expect(200);
    expect(rel.body.data.status).toBe("released");
    expect(rel.body.data.releasedTxHash).toBe(txHash);

    const logs = await request(app)
      .get(`/api/bounties/${id}/audit-logs`)
      .query({ limit: 10, offset: 0 })
      .expect(200);
    expect(logs.body.data.map((entry: { transition: string }) => entry.transition)).toEqual([
      "reserve",
      "submit",
      "release",
    ]);
    expect(logs.body.pagination.total).toBe(3);
  });

  it("GET /api/bounties/:id/audit-logs supports pagination", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR }).expect(200);
    await request(app)
      .post(`/api/bounties/${id}/submit`)
      .send({ contributor: CONTRIBUTOR, submissionUrl: "https://github.com/owner/repo-name/pull/1" })
      .expect(200);
    await request(app).post(`/api/bounties/${id}/release`).send({ maintainer: MAINTAINER }).expect(200);

    const first = await request(app).get(`/api/bounties/${id}/audit-logs`).query({ limit: 2, offset: 0 }).expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.pagination.hasMore).toBe(true);
    expect(first.body.pagination.nextOffset).toBe(2);

    const second = await request(app).get(`/api/bounties/${id}/audit-logs`).query({ limit: 2, offset: 2 }).expect(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.pagination.hasMore).toBe(false);
    expect(second.body.pagination.nextOffset).toBeNull();
  });

  it("GET /api/bounties/:id/audit-logs validates query params", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    const res = await request(app).get(`/api/bounties/${id}/audit-logs`).query({ limit: 0 }).expect(400);
    expect(res.body.error).toMatch(/limit/i);
  });

  it("GET /api/bounties/released/export.csv returns CSV export", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    await request(app)
      .post(`/api/bounties/${id}/reserve`)
      .send({ contributor: CONTRIBUTOR })
      .expect(200);

    await request(app)
      .post(`/api/bounties/${id}/submit`)
      .send({
        contributor: CONTRIBUTOR,
        submissionUrl: "https://github.com/owner/repo-name/pull/1",
      })
      .expect(200);

    await request(app)
      .post(`/api/bounties/${id}/release`)
      .send({ maintainer: MAINTAINER })
      .expect(200);

    const res = await request(app).get("/api/bounties/released/export.csv").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toContain("repo,issue_number,contributor,asset,amount,released_at");
    expect(res.text).toContain(CONTRIBUTOR);
  });

  it("POST /api/bounties/:id/refund returns refunded bounty", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    const ref = await request(app)
      .post(`/api/bounties/${id}/refund`)
      .send({ maintainer: MAINTAINER, transactionHash: "b".repeat(64) })
      .expect(200);
    expect(ref.body.data.status).toBe("refunded");
    expect(ref.body.data.refundedTxHash).toBe("b".repeat(64));
  });

  it("invalid reserve body returns 400", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    const res = await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: "not-a-key" }).expect(400);
    expect(res.body.error).toMatch(/contributor|public key|Must be valid/i);
  });

  it("domain errors from store return 400 with message", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR }).expect(200);

    const res = await request(app)
      .post(`/api/bounties/${id}/release`)
      .send({ maintainer: MAINTAINER })
      .expect(400);
    expect(res.body.error).toMatch(/submitted/i);
  });

  it("wrong maintainer on release returns 400", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR }).expect(200);
    await request(app)
      .post(`/api/bounties/${id}/submit`)
      .send({
        contributor: CONTRIBUTOR,
        submissionUrl: "https://github.com/owner/repo-name/pull/2",
      })
      .expect(200);

    const res = await request(app)
      .post(`/api/bounties/${id}/release`)
      .send({ maintainer: OTHER_ACCOUNT })
      .expect(400);
    expect(res.body.error).toMatch(/maintainer/i);
  });

  it("unknown bounty id returns 400 with not found", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties/BNT-9999/reserve")
      .send({ contributor: CONTRIBUTOR })
      .expect(400);
    expect(res.body.error).toMatch(/not found/i);
  });
});

describe("GET /api/leaderboard", () => {
  it("returns empty array when no bounties exist", async () => {
    const app = await getApp();
    const res = await request(app).get("/api/leaderboard").expect(200);
    expect(res.body.data).toEqual([]);
  });

  it("returns empty array when bounties exist but none are released", async () => {
    const app = await getApp();
    await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const res = await request(app).get("/api/leaderboard").expect(200);
    expect(res.body.data).toEqual([]);
  });

  it("returns contributor after a bounty is released", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR }).expect(200);
    await request(app)
      .post(`/api/bounties/${id}/submit`)
      .send({ contributor: CONTRIBUTOR, submissionUrl: "https://github.com/owner/repo/pull/1" })
      .expect(200);
    await request(app).post(`/api/bounties/${id}/release`).send({ maintainer: MAINTAINER }).expect(200);

    const res = await request(app).get("/api/leaderboard").expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    const entry = res.body.data[0];
    expect(entry.address).toBe(CONTRIBUTOR);
    expect(entry.totalXlm).toBe(validCreateBody.amount);
    expect(entry.bountiesCompleted).toBe(1);
  });

  it("aggregates multiple released bounties for the same contributor", async () => {
    const app = await getApp();

    for (let i = 0; i < 2; i++) {
      const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
      const id = created.data.id as string;
      await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR }).expect(200);
      await request(app)
        .post(`/api/bounties/${id}/submit`)
        .send({ contributor: CONTRIBUTOR, submissionUrl: `https://github.com/owner/repo/pull/${i + 1}` })
        .expect(200);
      await request(app).post(`/api/bounties/${id}/release`).send({ maintainer: MAINTAINER }).expect(200);
    }

    const res = await request(app).get("/api/leaderboard").expect(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].bountiesCompleted).toBe(2);
    expect(res.body.data[0].totalXlm).toBeCloseTo(validCreateBody.amount * 2);
  });

  it("ranks higher XLM earner first", async () => {
    const app = await getApp();

    // CONTRIBUTOR gets one bounty released
    const { body: c1 } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    await request(app).post(`/api/bounties/${c1.data.id}/reserve`).send({ contributor: CONTRIBUTOR }).expect(200);
    await request(app).post(`/api/bounties/${c1.data.id}/submit`).send({ contributor: CONTRIBUTOR, submissionUrl: "https://github.com/o/r/pull/1" }).expect(200);
    await request(app).post(`/api/bounties/${c1.data.id}/release`).send({ maintainer: MAINTAINER }).expect(200);

    // OTHER_ACCOUNT gets two bounties released (more XLM)
    for (let i = 0; i < 2; i++) {
      const { body: c2 } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
      await request(app).post(`/api/bounties/${c2.data.id}/reserve`).send({ contributor: OTHER_ACCOUNT }).expect(200);
      await request(app).post(`/api/bounties/${c2.data.id}/submit`).send({ contributor: OTHER_ACCOUNT, submissionUrl: `https://github.com/o/r/pull/${i + 10}` }).expect(200);
      await request(app).post(`/api/bounties/${c2.data.id}/release`).send({ maintainer: MAINTAINER }).expect(200);
    }

    const res = await request(app).get("/api/leaderboard").expect(200);
    expect(res.body.data[0].address).toBe(OTHER_ACCOUNT);
    expect(res.body.data[1].address).toBe(CONTRIBUTOR);
  });

  it("each entry has address, totalXlm, and bountiesCompleted fields", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR }).expect(200);
    await request(app).post(`/api/bounties/${id}/submit`).send({ contributor: CONTRIBUTOR, submissionUrl: "https://github.com/o/r/pull/1" }).expect(200);
    await request(app).post(`/api/bounties/${id}/release`).send({ maintainer: MAINTAINER }).expect(200);

    const res = await request(app).get("/api/leaderboard").expect(200);
    const entry = res.body.data[0];
    expect(entry).toHaveProperty("address");
    expect(entry).toHaveProperty("totalXlm");
    expect(entry).toHaveProperty("bountiesCompleted");
  });
});
