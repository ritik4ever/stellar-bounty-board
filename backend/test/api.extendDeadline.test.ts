import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINTAINER, OTHER_ACCOUNT, validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-api-extend-${randomUUID()}.json`);
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
    fs.unlinkSync(storeFile.replace(/\.json$/i, ".audit.json"));
  } catch {
    /* best-effort */
  }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

async function seedBounty(app: Express.Application): Promise<{ id: string; deadlineAt: number }> {
  const res = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
  return { id: res.body.data.id as string, deadlineAt: res.body.data.deadlineAt as number };
}

describe("POST /api/bounties/:id/extend-deadline", () => {
  it("extends the deadline for the maintainer and records the event", async () => {
    const app = await getApp();
    const { id, deadlineAt } = await seedBounty(app);

    const newDeadline = deadlineAt + 7 * 24 * 60 * 60; // +7 days

    const res = await request(app)
      .post(`/api/bounties/${id}/extend-deadline`)
      .send({ maintainer: MAINTAINER, newDeadline })
      .expect(200);

    expect(res.body.data.deadlineAt).toBe(newDeadline);
    expect(res.body.data.version).toBeGreaterThan(1);

    // Event log records a deadline_extended event with both deadlines.
    const eventsRes = await request(app).get(`/api/bounties/${id}/events`).expect(200);
    const event = eventsRes.body.data.find(
      (e: { type: string }) => e.type === "deadline_extended",
    );
    expect(event).toBeDefined();
    expect(event.actor).toBe(MAINTAINER);
    expect(event.details.previousDeadline).toBe(deadlineAt);
    expect(event.details.newDeadline).toBe(newDeadline);

    // Audit log records an extend_deadline transition.
    const auditRes = await request(app)
      .get(`/api/bounties/${id}/audit-logs`)
      .query({ limit: 10, offset: 0 })
      .expect(200);
    const audit = auditRes.body.data.find(
      (entry: { transition: string }) => entry.transition === "extend_deadline",
    );
    expect(audit).toBeDefined();
    expect(audit.actor).toBe(MAINTAINER);
  });

  it("rejects a new deadline that is earlier than the current one", async () => {
    const app = await getApp();
    const { id, deadlineAt } = await seedBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/extend-deadline`)
      .send({ maintainer: MAINTAINER, newDeadline: deadlineAt - 1000 })
      .expect(400);

    expect(res.body.error).toMatch(/later than the current deadline/i);
  });

  it("rejects a new deadline in the past", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/extend-deadline`)
      .send({ maintainer: MAINTAINER, newDeadline: 1 })
      .expect(400);

    expect(res.body.error).toMatch(/future/i);
  });

  it("rejects an extension from a non-maintainer", async () => {
    const app = await getApp();
    const { id, deadlineAt } = await seedBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/extend-deadline`)
      .send({ maintainer: OTHER_ACCOUNT, newDeadline: deadlineAt + 1000 })
      .expect(400);

    expect(res.body.error).toMatch(/does not match/i);
  });

  it("returns 400 for an invalid maintainer address", async () => {
    const app = await getApp();
    const { id, deadlineAt } = await seedBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/extend-deadline`)
      .send({ maintainer: "not-a-valid-address", newDeadline: deadlineAt + 1000 })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it("returns 400 for an unknown bounty id", async () => {
    const app = await getApp();

    const res = await request(app)
      .post("/api/bounties/BNT-9999/extend-deadline")
      .send({ maintainer: MAINTAINER, newDeadline: 1920000000 })
      .expect(400);

    expect(res.body.error).toMatch(/not found/i);
  });
});
