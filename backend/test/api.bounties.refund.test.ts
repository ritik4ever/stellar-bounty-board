import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTOR, MAINTAINER, OTHER_ACCOUNT, validCreateBody } from "./fixtures";

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-api-refund-${randomUUID()}.json`);
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

async function createBounty(app: Awaited<ReturnType<typeof getApp>>): Promise<string> {
  const res = await request(app).post("/api/bounties").send(validCreateBody).expect(201);
  return res.body.data.id as string;
}

describe("POST /api/bounties/:id/refund", () => {
  it("refunds an open bounty and returns the updated bounty data", async () => {
    const app = await getApp();
    const id = await createBounty(app);
    const transactionHash = "b".repeat(64);

    const res = await request(app)
      .post(`/api/bounties/${id}/refund`)
      .send({ maintainer: MAINTAINER, transactionHash })
      .expect(200);

    expect(res.body).toMatchObject({
      data: {
        id,
        status: "refunded",
        refundedTxHash: transactionHash,
      },
    });
    expect(res.body.data.refundedAt).toEqual(expect.any(Number));
  });

  it("rejects a refund request from a different maintainer", async () => {
    const app = await getApp();
    const id = await createBounty(app);

    const res = await request(app)
      .post(`/api/bounties/${id}/refund`)
      .send({ maintainer: OTHER_ACCOUNT })
      .expect(400);

    expect(res.body.error).toMatch(/maintainer address does not match/i);
  });

  it("rejects a refund for a bounty that has already been refunded", async () => {
    const app = await getApp();
    const id = await createBounty(app);
    const refundRequest = () =>
      request(app).post(`/api/bounties/${id}/refund`).send({ maintainer: MAINTAINER });

    await refundRequest().expect(200);
    const res = await refundRequest().expect(400);

    expect(res.body.error).toMatch(/already finalized/i);
  });

  it("rejects a refund for a submitted bounty", async () => {
    const app = await getApp();
    const id = await createBounty(app);

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

    const res = await request(app)
      .post(`/api/bounties/${id}/refund`)
      .send({ maintainer: MAINTAINER })
      .expect(400);

    expect(res.body.error).toMatch(/must be reviewed before refund/i);
  });

  it("returns 400 for an unknown bounty ID", async () => {
    const app = await getApp();

    const res = await request(app)
      .post("/api/bounties/UNKNOWN/refund")
      .send({ maintainer: MAINTAINER })
      .expect(400);

    expect(res.body.error).toMatch(/not found/i);
  });
});
