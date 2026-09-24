import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-body-limit-${randomUUID()}.json`);
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

// Builds a JSON string whose byte size exceeds the given kb threshold.
function oversizedJson(kb: number): object {
  return { padding: "x".repeat(kb * 1024) };
}

describe("body size limits", () => {
  it("rejects a payload over 32kb on a standard route with 413", async () => {
    const app = await getApp();
    // POST /api/bounties uses enforceBodyLimit('32kb')
    const res = await request(app)
      .post("/api/bounties")
      .set("Content-Type", "application/json")
      .send(oversizedJson(33));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/payload too large/i);
  });

  it("accepts a payload under 32kb on a standard route", async () => {
    const app = await getApp();
    // A tiny payload should not be rejected for size (may fail validation, not size)
    const res = await request(app)
      .post("/api/bounties")
      .set("Content-Type", "application/json")
      .send({ small: "body" });
    expect(res.status).not.toBe(413);
  });

  it("accepts a payload over 32kb but under 256kb on the notes route", async () => {
    const app = await getApp();
    // PATCH /api/bounties/:id/notes allows up to 256kb — a 40kb body should not be
    // rejected for size. The response will be 401/400 (auth/validation), never 413.
    const res = await request(app)
      .patch("/api/bounties/BNT-0001/notes")
      .set("Content-Type", "application/json")
      .send(oversizedJson(40));
    expect(res.status).not.toBe(413);
  });

  it("accepts a payload over 32kb but under 256kb on the submit route", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties/BNT-0001/submit")
      .set("Content-Type", "application/json")
      .send(oversizedJson(40));
    expect(res.status).not.toBe(413);
  });

  it("rejects a payload over 256kb on the notes route with 413", async () => {
    const app = await getApp();
    const res = await request(app)
      .patch("/api/bounties/BNT-0001/notes")
      .set("Content-Type", "application/json")
      .send(oversizedJson(257));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/payload too large/i);
  });

  it("rejects a payload over 256kb on the submit route with 413", async () => {
    const app = await getApp();
    const res = await request(app)
      .post("/api/bounties/BNT-0001/submit")
      .set("Content-Type", "application/json")
      .send(oversizedJson(257));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/payload too large/i);
  });
});
