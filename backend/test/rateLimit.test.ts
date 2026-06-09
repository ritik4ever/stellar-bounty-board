import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadLimiters() {
  return import("../src/utils");
}

afterEach(() => {
  delete process.env.NODE_ENV;
  delete process.env.RATE_LIMIT_WINDOW_MS;
  delete process.env.RATE_LIMIT_READ_MAX;
  delete process.env.RATE_LIMIT_MUTATION_MAX;
  vi.resetModules();
});

describe("rate limiting environment behavior", () => {
  it("does not return 429 for high-volume requests in NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    process.env.RATE_LIMIT_MUTATION_MAX = "1";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    vi.resetModules();

    const { mutationLimiter } = await loadLimiters();
    const app = express();
    app.post("/limited", mutationLimiter, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    for (let i = 0; i < 200; i += 1) {
      await request(app).post("/limited").send({ count: i }).expect(200);
    }
  });

  it("keeps read and mutation rate limits active in NODE_ENV=production", async () => {
    process.env.NODE_ENV = "production";
    process.env.RATE_LIMIT_READ_MAX = "2";
    process.env.RATE_LIMIT_MUTATION_MAX = "2";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    vi.resetModules();

    const { mutationLimiter, readLimiter } = await loadLimiters();
    const app = express();
    app.use(readLimiter);
    app.get("/limited", (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.post("/limited", mutationLimiter, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(app).get("/limited").expect(200);
    await request(app).get("/limited").expect(200);
    await request(app).get("/limited").expect(429);

    await request(app).post("/limited").send({ attempt: 1 }).expect(200);
    await request(app).post("/limited").send({ attempt: 2 }).expect(200);
    const limited = await request(app).post("/limited").send({ attempt: 3 }).expect(429);

    expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.body.error).toMatch(/too many requests/i);
  });
});
