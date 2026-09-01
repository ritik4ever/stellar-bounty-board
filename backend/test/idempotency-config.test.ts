import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Helper to load middleware dynamically after setting env vars
async function loadIdempotencyMiddleware() {
  const { idempotencyMiddleware, __resetIdempotencyStoreForTests } = await import("../src/middleware/idempotency");
  return { idempotencyMiddleware, __resetIdempotencyStoreForTests };
}

describe("idempotency middleware configurable TTL", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.IDEMPOTENCY_TTL_SECONDS = "1"; // 1 second TTL
  });

  it("respects custom TTL", async () => {
    const { idempotencyMiddleware, __resetIdempotencyStoreForTests } = await loadIdempotencyMiddleware();
    __resetIdempotencyStoreForTests();

    const app = express();
    app.use(express.json());
    app.post("/test", idempotencyMiddleware, (req, res) => {
      res.json({ processed: true, body: req.body });
    });

    // First request
    const first = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-1")
      .send({ val: 1 })
      .expect(200);

    expect(first.body).toEqual({ processed: true, body: { val: 1 } });

    // Wait for TTL (1 second)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Second request with same key, different body
    const second = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-1")
      .send({ val: 2 })
      .expect(200);

    // If it was still cached, it would return the first body ({ val: 1 })
    // If it expired, it should return the new body ({ val: 2 })
    expect(second.body).toEqual({ processed: true, body: { val: 2 } });
  });
});
