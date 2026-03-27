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

  it("reserve → submit → release flow via HTTP", async () => {
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

    const rel = await request(app)
      .post(`/api/bounties/${id}/release`)
      .send({ maintainer: MAINTAINER })
      .expect(200);
    expect(rel.body.data.status).toBe("released");
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
      .send({ maintainer: MAINTAINER })
      .expect(200);
    expect(ref.body.data.status).toBe("refunded");
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
