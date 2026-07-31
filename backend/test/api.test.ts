import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER, OTHER_ACCOUNT, validCreateBody } from "./fixtures";

function makeString(kb: number): string {
  return "x".repeat(kb * 1024);
}

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

describe("API — bounty list deadline filters", () => {
  it("deadlineBefore and deadlineAfter accept ISO 8601 strings", async () => {
    const app = await getApp();
    const createRes = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const bounty = createRes.body.data;

    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 40);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const beforeRes = await request(app)
      .get("/api/bounties")
      .query({ deadlineBefore: farFuture.toISOString() })
      .expect(200);
    expect(beforeRes.body.data.some((b: any) => b.id === bounty.id)).toBe(true);

    const afterRes = await request(app)
      .get("/api/bounties")
      .query({ deadlineAfter: yesterday.toISOString() })
      .expect(200);
    expect(afterRes.body.data.some((b: any) => b.id === bounty.id)).toBe(true);
  });

  it("invalid date string returns 400", async () => {
    const app = await getApp();
    await request(app)
      .get("/api/bounties")
      .query({ deadlineBefore: "not-a-valid-date" })
      .expect(400);
  });

  it("deadlineBefore filters correctly", async () => {
    const app = await getApp();
    const now = Math.floor(Date.now() / 1000);

    // Create bounties with different deadlines
    const bounty1 = (
      await request(app)
        .post("/api/bounties")
        .send({ ...validCreateBody, deadlineDays: 1 })
        .expect(201)
    ).body.data; // deadline at now + 1 day
    const bounty2 = (
      await request(app)
        .post("/api/bounties")
        .send({ ...validCreateBody, deadlineDays: 30 })
        .expect(201)
    ).body.data; // deadline at now + 30 days

    const filterDate = new Date((now + 2 * 24 * 60 * 60) * 1000).toISOString(); // 2 days from now
    const res = await request(app)
      .get("/api/bounties")
      .query({ deadlineBefore: filterDate })
      .expect(200);

    expect(res.body.data.some((b: any) => b.id === bounty1.id)).toBe(true);
    expect(res.body.data.some((b: any) => b.id === bounty2.id)).toBe(false);
  });

  it("deadlineAfter filters correctly", async () => {
    const app = await getApp();
    const now = Math.floor(Date.now() / 1000);

    // Create bounties with different deadlines
    const bounty1 = (
      await request(app)
        .post("/api/bounties")
        .send({ ...validCreateBody, deadlineDays: 1 })
        .expect(201)
    ).body.data; // deadline at now + 1 day
    const bounty2 = (
      await request(app)
        .post("/api/bounties")
        .send({ ...validCreateBody, deadlineDays: 30 })
        .expect(201)
    ).body.data; // deadline at now + 30 days

    const filterDate = new Date((now + 2 * 24 * 60 * 60) * 1000).toISOString(); // 2 days from now
    const res = await request(app)
      .get("/api/bounties")
      .query({ deadlineAfter: filterDate })
      .expect(200);

    expect(res.body.data.some((b: any) => b.id === bounty1.id)).toBe(false);
    expect(res.body.data.some((b: any) => b.id === bounty2.id)).toBe(true);
  });

  it("deadlineBefore and deadlineAfter combined with AND logic", async () => {
    const app = await getApp();
    const now = Math.floor(Date.now() / 1000);

    // Create bounties with different deadlines
    const bounty1 = (
      await request(app)
        .post("/api/bounties")
        .send({ ...validCreateBody, deadlineDays: 1 })
        .expect(201)
    ).body.data; // deadline at now + 1 day
    const bounty2 = (
      await request(app)
        .post("/api/bounties")
        .send({ ...validCreateBody, deadlineDays: 10 })
        .expect(201)
    ).body.data; // deadline at now + 10 days
    const bounty3 = (
      await request(app)
        .post("/api/bounties")
        .send({ ...validCreateBody, deadlineDays: 30 })
        .expect(201)
    ).body.data; // deadline at now + 30 days

    const afterDate = new Date((now + 2 * 24 * 60 * 60) * 1000).toISOString(); // 2 days from now
    const beforeDate = new Date((now + 20 * 24 * 60 * 60) * 1000).toISOString(); // 20 days from now
    const res = await request(app)
      .get("/api/bounties")
      .query({ deadlineAfter: afterDate, deadlineBefore: beforeDate })
      .expect(200);

    expect(res.body.data.some((b: any) => b.id === bounty1.id)).toBe(false);
    expect(res.body.data.some((b: any) => b.id === bounty2.id)).toBe(true);
    expect(res.body.data.some((b: any) => b.id === bounty3.id)).toBe(false);
  });

  it("deadline filters combined with q filter", async () => {
    const app = await getApp();
    const now = Math.floor(Date.now() / 1000);

    // Create bounties with different deadlines and titles
    const bounty1 = (
      await request(app)
        .post("/api/bounties")
        .send({ ...validCreateBody, deadlineDays: 1, title: "Test bounty 1" })
        .expect(201)
    ).body.data;
    const bounty2 = (
      await request(app)
        .post("/api/bounties")
        .send({ ...validCreateBody, deadlineDays: 30, title: "Another test bounty" })
        .expect(201)
    ).body.data;

    const filterDate = new Date((now + 2 * 24 * 60 * 60) * 1000).toISOString(); // 2 days from now
    const res = await request(app)
      .get("/api/bounties")
      .query({ deadlineBefore: filterDate, q: "Test" })
      .expect(200);

    expect(res.body.data.some((b: any) => b.id === bounty1.id)).toBe(true);
    expect(res.body.data.some((b: any) => b.id === bounty2.id)).toBe(false);
  });
});

describe("API — bounty list contributor filter", () => {
  it("filters bounties by exact contributor address", async () => {
    const app = await getApp();
    const created = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const bountyId = created.body.data.id;

    await request(app)
      .post(`/api/bounties/${bountyId}/reserve`)
      .send({ contributor: CONTRIBUTOR })
      .expect(200);

    const matched = await request(app)
      .get("/api/bounties")
      .query({ contributor: CONTRIBUTOR })
      .expect(200);

    expect(matched.body.data.some((b: any) => b.id === bountyId)).toBe(true);
  });

  it("returns no bounties when no contributor matches", async () => {
    const app = await getApp();
    const created = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const bountyId = created.body.data.id;

    await request(app)
      .post(`/api/bounties/${bountyId}/reserve`)
      .send({ contributor: CONTRIBUTOR })
      .expect(200);

    const matched = await request(app)
      .get("/api/bounties")
      .query({ contributor: OTHER_ACCOUNT })
      .expect(200);

    expect(matched.body.data).toHaveLength(0);
  });

  it("rejects invalid contributor addresses", async () => {
    const app = await getApp();

    const res = await request(app)
      .get("/api/bounties")
      .query({ contributor: "not-a-valid-address" })
      .expect(400);

    expect(res.body.error).toMatch(/contributor|Stellar public key/i);
  });
});

describe("API — admin audit log endpoint", () => {
  it("GET /api/audit-log returns all audit logs", async () => {
    const app = await getApp();
    
    // Create a bounty and go through full lifecycle to generate audit logs
    const createRes = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const bountyId = createRes.body.data.id;
    
    await request(app)
      .post(`/api/bounties/${bountyId}/reserve`)
      .send({ contributor: CONTRIBUTOR })
      .expect(200);
    await request(app)
      .post(`/api/bounties/${bountyId}/submit`)
      .send({ 
        contributor: CONTRIBUTOR, 
        submissionUrl: "https://github.com/owner/repo-name/pull/1" 
      })
      .expect(200);
    await request(app)
      .post(`/api/bounties/${bountyId}/release`)
      .send({ maintainer: MAINTAINER })
      .expect(200);

    const auditRes = await request(app).get("/api/audit-log").expect(200);
    
    expect(auditRes.body.data.length).toBe(3); // reserve, submit, release
    expect(auditRes.body.pagination.total).toBe(3);
  });

  it("GET /api/audit-log filters by actor", async () => {
    const app = await getApp();
    
    const createRes = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const bountyId = createRes.body.data.id;
    
    await request(app)
      .post(`/api/bounties/${bountyId}/reserve`)
      .send({ contributor: CONTRIBUTOR })
      .expect(200);

    const auditRes = await request(app)
      .get("/api/audit-log")
      .query({ actor: CONTRIBUTOR })
      .expect(200);
      
    expect(auditRes.body.data.length).toBe(1);
    expect(auditRes.body.data[0].actor).toBe(CONTRIBUTOR);
  });

  it("GET /api/audit-log filters by transition", async () => {
    const app = await getApp();
    
    const createRes = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const bountyId = createRes.body.data.id;
    
    await request(app)
      .post(`/api/bounties/${bountyId}/reserve`)
      .send({ contributor: CONTRIBUTOR })
      .expect(200);
    await request(app)
      .post(`/api/bounties/${bountyId}/submit`)
      .send({ 
        contributor: CONTRIBUTOR, 
        submissionUrl: "https://github.com/owner/repo-name/pull/1" 
      })
      .expect(200);

    const auditRes = await request(app)
      .get("/api/audit-log")
      .query({ transition: "reserve" })
      .expect(200);
      
    expect(auditRes.body.data.length).toBe(1);
    expect(auditRes.body.data[0].transition).toBe("reserve");
  });

  it("GET /api/audit-log uses combined filters", async () => {
    const app = await getApp();
    
    const createRes = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const bountyId = createRes.body.data.id;
    
    await request(app)
      .post(`/api/bounties/${bountyId}/reserve`)
      .send({ contributor: CONTRIBUTOR })
      .expect(200);
    await request(app)
      .post(`/api/bounties/${bountyId}/submit`)
      .send({ 
        contributor: CONTRIBUTOR, 
        submissionUrl: "https://github.com/owner/repo-name/pull/1" 
      })
      .expect(200);

    const auditRes = await request(app)
      .get("/api/audit-log")
      .query({ 
        actor: CONTRIBUTOR, 
        transition: "submit",
        fromStatus: "reserved",
        toStatus: "submitted"
      })
      .expect(200);
      
    expect(auditRes.body.data.length).toBe(1);
    expect(auditRes.body.data[0].actor).toBe(CONTRIBUTOR);
    expect(auditRes.body.data[0].transition).toBe("submit");
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
      .get(`/api/bounties/${id}/audit-log`)
      .query({ page: 1, pageSize: 10 })
      .expect(200);
    expect(logs.body.data.map((entry: { transition: string }) => entry.transition)).toEqual([
      "reserve",
      "submit",
      "release",
    ]);
    expect(logs.body.total).toBe(3);
    expect(logs.body.page).toBe(1);
    expect(logs.body.pageSize).toBe(10);
  });

  it("GET /api/bounties/:id/audit-log supports pagination", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR }).expect(200);
    await request(app)
      .post(`/api/bounties/${id}/submit`)
      .send({ contributor: CONTRIBUTOR, submissionUrl: "https://github.com/owner/repo-name/pull/1" })
      .expect(200);
    await request(app).post(`/api/bounties/${id}/release`).send({ maintainer: MAINTAINER }).expect(200);

    const first = await request(app).get(`/api/bounties/${id}/audit-log`).query({ page: 1, pageSize: 2 }).expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.page).toBe(1);
    expect(first.body.pageSize).toBe(2);
    expect(first.body.total).toBe(3);

    const second = await request(app).get(`/api/bounties/${id}/audit-log`).query({ page: 2, pageSize: 2 }).expect(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.page).toBe(2);
    expect(second.body.pageSize).toBe(2);
    expect(second.body.total).toBe(3);
  });

  it("GET /api/bounties/:id/audit-log validates query params", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    const res = await request(app).get(`/api/bounties/${id}/audit-log`).query({ page: 0 }).expect(400);
    expect(res.body.error).toMatch(/page/i);
  });

  it("GET /api/bounties/:id/audit-log returns 404 for unknown bounty IDs", async () => {
    const app = await getApp();

    const res = await request(app).get('/api/bounties/BNT-9999/audit-log').expect(404);
    expect(res.body.error).toMatch(/not found/i);
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

  it("POST /api/bounties/:id/cancel returns canceled bounty", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    const res = await request(app)
      .post(`/api/bounties/${id}/cancel`)
      .send({ maintainer: MAINTAINER, transactionHash: "c".repeat(64) })
      .expect(200);
    expect(res.body.data.status).toBe("refunded");
    expect(res.body.data.canceledAt).toBeDefined();
    expect(res.body.data.canceledTxHash).toBe("c".repeat(64));
  });

  it("POST /api/bounties/:id/cancel rejects reserved bounty", async () => {
    const app = await getApp();
    const { body: created } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = created.data.id as string;

    await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR }).expect(200);

    const res = await request(app)
      .post(`/api/bounties/${id}/cancel`)
      .send({ maintainer: MAINTAINER })
      .expect(400);
    expect(res.body.error).toMatch(/only open bounties/i);
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
      .send({ contributor: CONTRIBUTOR, submissionUrl: "https://github.com/owner/repo-name/pull/1" })
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
        .send({ contributor: CONTRIBUTOR, submissionUrl: `https://github.com/owner/repo-name/pull/${i + 1}` })
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
    await request(app).post(`/api/bounties/${c1.data.id}/submit`).send({ contributor: CONTRIBUTOR, submissionUrl: "https://github.com/owner/repo-name/pull/1" }).expect(200);
    await request(app).post(`/api/bounties/${c1.data.id}/release`).send({ maintainer: MAINTAINER }).expect(200);

    // OTHER_ACCOUNT gets two bounties released (more XLM)
    for (let i = 0; i < 2; i++) {
      const { body: c2 } = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
      await request(app).post(`/api/bounties/${c2.data.id}/reserve`).send({ contributor: OTHER_ACCOUNT }).expect(200);
      await request(app).post(`/api/bounties/${c2.data.id}/submit`).send({ contributor: OTHER_ACCOUNT, submissionUrl: `https://github.com/owner/repo-name/pull/${i + 10}` }).expect(200);
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
    await request(app).post(`/api/bounties/${id}/submit`).send({ contributor: CONTRIBUTOR, submissionUrl: "https://github.com/owner/repo-name/pull/1" }).expect(200);
    await request(app).post(`/api/bounties/${id}/release`).send({ maintainer: MAINTAINER }).expect(200);

    const res = await request(app).get("/api/leaderboard").expect(200);
    const entry = res.body.data[0];
    expect(entry).toHaveProperty("address");
    expect(entry).toHaveProperty("totalXlm");
    expect(entry).toHaveProperty("bountiesCompleted");
  });
});

describe("API — body size limit and JSON parse errors", () => {
  it("POST with payload larger than 32kb returns 413", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties")
      .send({ ...validCreateBody, title: makeString(33) })
      .expect(413);
    expect(res.body).toEqual({ error: "Payload too large", maxBytes: 32768 });
  });

  it("POST with malformed JSON returns 400", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties")
      .set("Content-Type", "application/json")
      .send("{invalid}")
      .expect(400);
    expect(res.body).toEqual({ error: "Invalid JSON" });
  });
});

describe("API — bounty caching", () => {
  it("GET /api/bounties/:id returns ETag and handles conditional requests", async () => {
    const app = await getApp();
    const createRes = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
    const id = createRes.body.data.id as string;
    
    // First fetch
    const fetch1 = await request(app).get(`/api/bounties/${id}`).expect(200);
    expect(fetch1.headers).toHaveProperty('etag');
    const etag = fetch1.headers.etag;
    expect(fetch1.headers['cache-control']).toBe('max-age=5');
    
    // Second fetch with If-None-Match
    await request(app).get(`/api/bounties/${id}`).set('If-None-Match', etag).expect(304);
    
    // Third fetch after version change (reserve bounty changes version)
    await request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR }).expect(200);
    
    const fetch3 = await request(app).get(`/api/bounties/${id}`).set('If-None-Match', etag).expect(200);
    expect(fetch3.headers.etag).not.toBe(etag);
  });
});
