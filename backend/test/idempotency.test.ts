import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { idempotencyMiddleware, __resetIdempotencyStoreForTests } from "../src/middleware/idempotency";
import { CONTRIBUTOR, MAINTAINER, validCreateBody } from "./fixtures";

let storeFile: string;

describe("idempotency middleware", () => {
  beforeEach(async () => {
    storeFile = path.join(os.tmpdir(), `bounty-idempotency-${randomUUID()}.json`);
    fs.writeFileSync(storeFile, "[]", "utf8");
    process.env.BOUNTY_STORE_PATH = storeFile;
    vi.resetModules();
    __resetIdempotencyStoreForTests();
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

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.post("/test", idempotencyMiddleware, (req, res) => {
      const { counter } = req.body;
      res.json({ result: counter ?? 0, processed: true });
    });
    return app;
  }

  it("returns cached response for duplicate Idempotency-Key", async () => {
    const app = buildApp();

    const first = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-1")
      .send({ counter: 1 })
      .expect(200);

    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-1")
      .send({ counter: 999 })
      .expect(200);

    expect(second.body).toEqual(first.body);
    expect(first.body).toEqual({ result: 1, processed: true });
  });

  it("different keys are treated independently", async () => {
    const app = buildApp();

    const first = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-a")
      .send({ counter: 10 })
      .expect(200);

    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-b")
      .send({ counter: 20 })
      .expect(200);

    expect(first.body).toEqual({ result: 10, processed: true });
    expect(second.body).toEqual({ result: 20, processed: true });
  });

  it("passes through when no Idempotency-Key is set", async () => {
    const app = buildApp();

    const first = await request(app)
      .post("/test")
      .send({ counter: 1 })
      .expect(200);

    const second = await request(app)
      .post("/test")
      .send({ counter: 2 })
      .expect(200);

    expect(first.body).toEqual({ result: 1, processed: true });
    expect(second.body).toEqual({ result: 2, processed: true });
  });

  it("caches error responses too", async () => {
    const app = express();
    app.use(express.json());
    app.post("/test", idempotencyMiddleware, (req, res) => {
      const { counter } = req.body;
      if (counter === undefined) {
        res.status(400).json({ error: "counter required" });
        return;
      }
      res.json({ result: counter });
    });

    const first = await request(app)
      .post("/test")
      .set("Idempotency-Key", "err-key")
      .send({})
      .expect(400);

    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", "err-key")
      .send({ counter: 42 })
      .expect(400);

    expect(second.body).toEqual(first.body);
    expect(first.body).toEqual({ error: "counter required" });
  });

  it("expired key is evicted after TTL", async () => {
    vi.useFakeTimers();
    const app = buildApp();

    const first = await request(app)
      .post("/test")
      .set("Idempotency-Key", "ttl-key")
      .send({ counter: 1 })
      .expect(200);

    expect(first.body).toEqual({ result: 1, processed: true });

    const tenMinPlus1 = 10 * 60 * 1000 + 1;
    vi.advanceTimersByTime(tenMinPlus1);

    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", "ttl-key")
      .send({ counter: 2 })
      .expect(200);

    expect(second.body).toEqual({ result: 2, processed: true });
    vi.useRealTimers();
  });

  it("reuses the release response when refund reuses the same idempotency key", async () => {
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

    const first = await request(app)
      .post(`/api/bounties/${id}/release`)
      .set("Idempotency-Key", "release-refund-collision")
      .send({ maintainer: MAINTAINER, transactionHash: "a".repeat(64) })
      .expect(200);

    const second = await request(app)
      .post(`/api/bounties/${id}/refund`)
      .set("Idempotency-Key", "release-refund-collision")
      .send({ maintainer: MAINTAINER, transactionHash: "b".repeat(64) })
      .expect(200);

    expect(second.body).toEqual(first.body);
    expect(first.body.data.status).toBe("released");
    expect(first.body.data.releasedTxHash).toBe("a".repeat(64));
    expect(first.body.data.refundedTxHash).toBeUndefined();

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
  });

  it("allows a fresh idempotency key to execute a subsequent refund attempt", async () => {
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
        submissionUrl: "https://github.com/owner/repo-name/pull/2",
      })
      .expect(200);

    const release = await request(app)
      .post(`/api/bounties/${id}/release`)
      .set("Idempotency-Key", "release-key")
      .send({ maintainer: MAINTAINER, transactionHash: "c".repeat(64) })
      .expect(200);

    const refund = await request(app)
      .post(`/api/bounties/${id}/refund`)
      .set("Idempotency-Key", "refund-key")
      .send({ maintainer: MAINTAINER, transactionHash: "d".repeat(64) })
      .expect(400);

    expect(release.body.data.status).toBe("released");
    expect(refund.body.error).toMatch(/finalized/i);

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
  });
});
