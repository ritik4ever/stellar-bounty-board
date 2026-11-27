import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINTAINER, validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-bulk-${randomUUID()}.json`);
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
    fs.unlinkSync(storeFile.replace(/\.json$/i, ".audit.json"));
  } catch {
    /* best-effort */
  }
});

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

async function createOpenBounty(app: any) {
  const res = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
  return res.body.data as { id: string };
}

describe("POST /api/bounties/bulk-action (#829)", () => {
  it("refunds every selected bounty and reports per-item success", async () => {
    const app = await getApp();
    const b1 = await createOpenBounty(app);
    const b2 = await createOpenBounty(app);

    const res = await request(app)
      .post("/api/bounties/bulk-action")
      .send({ action: "refund", bountyIds: [b1.id, b2.id], maintainer: MAINTAINER })
      .expect(200);

    expect(res.body.data.succeeded).toBe(2);
    expect(res.body.data.failed).toBe(0);
    expect(res.body.data.results).toHaveLength(2);
    for (const result of res.body.data.results) {
      expect(result.success).toBe(true);
      expect(result.status).toBe("refunded");
    }
  });

  it("keeps processing after a per-item failure and surfaces both outcomes", async () => {
    const app = await getApp();
    const ok = await createOpenBounty(app);
    const missingId = "DOES-NOT-EXIST";

    const res = await request(app)
      .post("/api/bounties/bulk-action")
      .send({ action: "refund", bountyIds: [ok.id, missingId], maintainer: MAINTAINER })
      .expect(200);

    expect(res.body.data.succeeded).toBe(1);
    expect(res.body.data.failed).toBe(1);

    const byId = new Map<string, any>(
      res.body.data.results.map((r: any) => [r.bountyId, r])
    );
    expect(byId.get(ok.id).success).toBe(true);
    expect(byId.get(missingId).success).toBe(false);
    expect(byId.get(missingId).error).toBeTruthy();
  });

  it("reports already-finalized bounties as failures without hiding successes", async () => {
    const app = await getApp();
    const finalized = await createOpenBounty(app);
    const fresh = await createOpenBounty(app);

    // Finalize one bounty first.
    await request(app)
      .post(`/api/bounties/${finalized.id}/refund`)
      .send({ maintainer: MAINTAINER })
      .expect(200);

    const res = await request(app)
      .post("/api/bounties/bulk-action")
      .send({
        action: "refund",
        bountyIds: [finalized.id, fresh.id],
        maintainer: MAINTAINER,
      })
      .expect(200);

    expect(res.body.data.succeeded).toBe(1);
    expect(res.body.data.failed).toBe(1);
    const byId = new Map<string, any>(
      res.body.data.results.map((r: any) => [r.bountyId, r])
    );
    expect(byId.get(finalized.id).success).toBe(false);
    expect(byId.get(finalized.id).error).toMatch(/finalized/i);
    expect(byId.get(fresh.id).success).toBe(true);
  });

  it("rejects an empty bounty list with 400", async () => {
    const app = await getApp();
    await request(app)
      .post("/api/bounties/bulk-action")
      .send({ action: "refund", bountyIds: [], maintainer: MAINTAINER })
      .expect(400);
  });

  it("rejects an unsupported action with 400", async () => {
    const app = await getApp();
    await request(app)
      .post("/api/bounties/bulk-action")
      .send({ action: "cancel", bountyIds: ["BNT-0001"], maintainer: MAINTAINER })
      .expect(400);
  });
});
