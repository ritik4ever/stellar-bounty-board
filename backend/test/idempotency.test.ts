import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { idempotencyMiddleware, __resetIdempotencyStoreForTests } from "../src/middleware/idempotency";

describe("idempotency middleware", () => {
  beforeEach(() => {
    __resetIdempotencyStoreForTests();
  });

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
});
