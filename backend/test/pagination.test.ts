import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINTAINER, validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-pagination-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  try { fs.unlinkSync(storeFile); } catch { /* best-effort */ }
  try { fs.unlinkSync(storeFile.replace(/\.json$/i, ".audit.json")); } catch { /* best-effort */ }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

async function seedBounties(app: Awaited<ReturnType<typeof getApp>>, count: number) {
  for (let i = 0; i < count; i++) {
    await request(app)
      .post("/api/bounties")
      .set("x-maintainer-address", MAINTAINER)
      .send({ ...validCreateBody, title: `Bounty ${i + 1}` })
      .expect(201);
  }
}

describe("GET /api/bounties — pagination", () => {
  it("returns default pageSize=20 and pagination metadata", async () => {
    const app = await getApp();
    await seedBounties(app, 25);

    const res = await request(app).get("/api/bounties").expect(200);

    expect(res.body.data).toHaveLength(20);
    expect(res.body.total).toBe(25);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    expect(res.body.hasMore).toBe(true);
    expect(res.headers["x-total-count"]).toBe("25");
  });

  it("returns second page with remaining items", async () => {
    const app = await getApp();
    await seedBounties(app, 25);

    const res = await request(app).get("/api/bounties?page=2&pageSize=20").expect(200);

    expect(res.body.data).toHaveLength(5);
    expect(res.body.page).toBe(2);
    expect(res.body.hasMore).toBe(false);
  });

  it("hasMore is false on the last page", async () => {
    const app = await getApp();
    await seedBounties(app, 10);

    const res = await request(app).get("/api/bounties?page=1&pageSize=10").expect(200);

    expect(res.body.data).toHaveLength(10);
    expect(res.body.hasMore).toBe(false);
  });

  it("returns empty data array when page is beyond total", async () => {
    const app = await getApp();
    await seedBounties(app, 5);

    const res = await request(app).get("/api/bounties?page=99&pageSize=20").expect(200);

    expect(res.body.data).toHaveLength(0);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.total).toBe(5);
  });

  it("returns 400 when pageSize exceeds maximum of 100", async () => {
    const app = await getApp();
    const res = await request(app).get("/api/bounties?pageSize=101").expect(400);
    expect(res.body.error).toMatch(/pageSize/i);
  });

  it("returns 400 for non-integer pageSize", async () => {
    const app = await getApp();
    const res = await request(app).get("/api/bounties?pageSize=abc").expect(400);
    expect(res.body.error).toMatch(/pageSize/i);
  });

  it("accepts custom pageSize within bounds", async () => {
    const app = await getApp();
    await seedBounties(app, 10);

    const res = await request(app).get("/api/bounties?pageSize=5").expect(200);

    expect(res.body.data).toHaveLength(5);
    expect(res.body.pageSize).toBe(5);
    expect(res.body.hasMore).toBe(true);
  });

  it("combines ?q filter with pagination", async () => {
    const app = await getApp();
    await seedBounties(app, 5);
    // Seed a uniquely-titled bounty for filter testing
    await request(app)
      .post("/api/bounties")
      .set("x-maintainer-address", MAINTAINER)
      .send({ ...validCreateBody, title: "UniqueFilterTarget" })
      .expect(201);

    const res = await request(app).get("/api/bounties?q=UniqueFilterTarget&pageSize=20").expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.hasMore).toBe(false);
  });
});
