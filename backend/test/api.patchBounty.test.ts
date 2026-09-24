/**
 * Tests for PATCH /api/bounties/:id
 *
 * Acceptance criteria (issue #770):
 *   1. A maintainer can PATCH allowed fields on their own bounty successfully.
 *   2. Attempting to PATCH an immutable field (e.g. amount) is rejected with
 *      a validation error.
 *   3. A non-owning maintainer cannot PATCH another maintainer's bounty.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINTAINER, OTHER_ACCOUNT, validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-api-patch-${randomUUID()}.json`);
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

async function seedBounty(app: Express.Application): Promise<{
  id: string;
  deadlineAt: number;
  title: string;
  summary: string;
  labels: string[];
}> {
  const res = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
  const b = res.body.data;
  return {
    id: b.id as string,
    deadlineAt: b.deadlineAt as number,
    title: b.title as string,
    summary: b.summary as string,
    labels: b.labels as string[],
  };
}

// ---------------------------------------------------------------------------
// Happy-path — individual fields
// ---------------------------------------------------------------------------

describe("PATCH /api/bounties/:id — happy path", () => {
  it("updates the title only", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);
    const newTitle = "Updated title for the bounty dashboard";

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, title: newTitle })
      .expect(200);

    expect(res.body.data.title).toBe(newTitle);
    expect(res.body.data.version).toBeGreaterThan(1);
  });

  it("updates the description only", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);
    const newDescription =
      "Updated description with at least twenty characters to pass validation.";

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, description: newDescription })
      .expect(200);

    expect(res.body.data.summary).toBe(newDescription);
    expect(res.body.data.version).toBeGreaterThan(1);
  });

  it("updates labels only", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);
    const newLabels = ["enhancement", "good first issue"];

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, labels: newLabels })
      .expect(200);

    expect(res.body.data.labels).toEqual(newLabels);
    expect(res.body.data.version).toBeGreaterThan(1);
  });

  it("updates the deadline only", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);
    const futureDeadline = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60; // 90 days

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, deadline: futureDeadline })
      .expect(200);

    expect(res.body.data.deadlineAt).toBe(futureDeadline);
    expect(res.body.data.version).toBeGreaterThan(1);
  });

  it("updates multiple fields in one request", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);
    const newTitle = "Multi-field update test title here";
    const newDescription = "Updated description with at least twenty characters.";
    const newLabels = ["backend", "help wanted"];
    const futureDeadline = Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60;

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({
        maintainer: MAINTAINER,
        title: newTitle,
        description: newDescription,
        labels: newLabels,
        deadline: futureDeadline,
      })
      .expect(200);

    const bounty = res.body.data;
    expect(bounty.title).toBe(newTitle);
    expect(bounty.summary).toBe(newDescription);
    expect(bounty.labels).toEqual(newLabels);
    expect(bounty.deadlineAt).toBe(futureDeadline);
    expect(bounty.version).toBeGreaterThan(1);
  });

  it("returns 200 and the unchanged bounty when no field actually differs", async () => {
    const app = await getApp();
    const { id, title } = await seedBounty(app);

    // Send the same title — nothing should change
    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, title })
      .expect(200);

    // version is not bumped because nothing changed
    expect(res.body.data.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

describe("PATCH /api/bounties/:id — audit log", () => {
  it("records a patch_fields audit entry with a field diff", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);
    const newTitle = "Audited patch bounty title update";

    await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, title: newTitle })
      .expect(200);

    const auditRes = await request(app)
      .get(`/api/bounties/${id}/audit-logs`)
      .query({ limit: 10, offset: 0 })
      .expect(200);

    const patchEntry = auditRes.body.data.find(
      (e: { transition: string }) => e.transition === "patch_fields",
    );

    expect(patchEntry).toBeDefined();
    expect(patchEntry.actor).toBe(MAINTAINER);
    expect(patchEntry.metadata).toMatchObject({
      title_to: newTitle,
    });
    expect(patchEntry.metadata).toHaveProperty("title_from");
  });
});

// ---------------------------------------------------------------------------
// Authorization — non-owning maintainer
// ---------------------------------------------------------------------------

describe("PATCH /api/bounties/:id — authorization", () => {
  it("rejects a PATCH from a non-owning maintainer (403/400)", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: OTHER_ACCOUNT, title: "Unauthorized title update here" })
      .expect(400);

    expect(res.body.error).toMatch(/does not match/i);
  });

  it("rejects an invalid Stellar maintainer address", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: "not-a-stellar-key", title: "Some valid title text" })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Immutable field rejection
// ---------------------------------------------------------------------------

describe("PATCH /api/bounties/:id — immutable field rejection", () => {
  it("rejects amount as an immutable field", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, amount: 999 })
      .expect(400);

    // validateBody returns { error: 'Validation failed', details: [...] }
    const detail = JSON.stringify(res.body.details ?? res.body.error);
    expect(detail).toMatch(/amount/i);
  });

  it("rejects status as an immutable field", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, status: "released" })
      .expect(400);

    const detail = JSON.stringify(res.body.details ?? res.body.error);
    expect(detail).toMatch(/status/i);
  });

  it("rejects contributor as an immutable field", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, contributor: OTHER_ACCOUNT })
      .expect(400);

    const detail = JSON.stringify(res.body.details ?? res.body.error);
    expect(detail).toMatch(/contributor/i);
  });
});

// ---------------------------------------------------------------------------
// Validation edge cases
// ---------------------------------------------------------------------------

describe("PATCH /api/bounties/:id — validation", () => {
  it("rejects a request with no patchable fields", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER })
      .expect(400);

    // validateBody returns { error: 'Validation failed', details: [...] }
    const detail = JSON.stringify(res.body.details ?? res.body.error);
    expect(detail).toMatch(/title|description|labels|deadline/i);
  });

  it("rejects a title that is too short", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, title: "Hi" })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it("rejects a description that is too short", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, description: "Short" })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it("rejects more than 6 labels", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, labels: ["a", "b", "c", "d", "e", "f", "g"] })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it("rejects a deadline in the past", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, deadline: 1 })
      .expect(400);

    expect(res.body.error).toMatch(/future/i);
  });

  it("returns 400 for an unknown bounty id", async () => {
    const app = await getApp();

    const res = await request(app)
      .patch("/api/bounties/BNT-9999")
      .set("Content-Type", "application/json")
      .send({ maintainer: MAINTAINER, title: "Valid title for test" })
      .expect(400);

    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 4xx when Content-Type is missing", async () => {
    const app = await getApp();
    const { id } = await seedBounty(app);

    // requireJsonContentType middleware returns 415 for missing/wrong Content-Type
    const res = await request(app)
      .patch(`/api/bounties/${id}`)
      // no Content-Type header
      .send(JSON.stringify({ maintainer: MAINTAINER, title: "Content type test title" }))
      .expect(415);

    expect(res.body.error).toBeDefined();
  });
});
