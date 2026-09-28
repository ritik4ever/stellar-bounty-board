import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { readLimiter, mutationLimiter, webhookLimiter, createRateLimiter } from "../src/utils";
import { getOperationalConfig } from "../src/config";

/** Builds a one-route app whose only protection is the limiter under test. */
function buildGuardedApp(limiter: express.RequestHandler): express.Express {
  const app = express();
  app.get("/guarded", limiter, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe("Rate Limiting", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(readLimiter);
    app.get("/test-read", (req, res) => {
      res.status(200).json({ ok: true });
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not rate limit when NODE_ENV=test and RATE_LIMIT_TEST_BYPASS=true", async () => {
    // Both signals are present: NODE_ENV=test comes from the runner and the
    // explicit opt-in is configured in vitest.config.ts (#1465).
    const config = getOperationalConfig();
    const promises = Array.from({ length: config.rateLimitTestCount }, () =>
      request(app).get("/test-read")
    );
    const responses = await Promise.all(promises);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });

  it("exports the read, mutation and webhook tiers", () => {
    expect(typeof readLimiter).toBe("function");
    expect(typeof mutationLimiter).toBe("function");
    expect(typeof webhookLimiter).toBe("function");
  });

  it("keeps rate limiting enabled when NODE_ENV=test but the opt-in is missing (#1465)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RATE_LIMIT_TEST_BYPASS", "");

    // A limiter built in this environment must be a real one: a stray
    // NODE_ENV=test may not switch the protection off on its own.
    const guarded = buildGuardedApp(createRateLimiter({ limit: 1, windowMs: 60_000 }));

    expect((await request(guarded).get("/guarded")).status).toBe(200);
    expect((await request(guarded).get("/guarded")).status).toBe(429);
  });

  it("keeps rate limiting enabled when the opt-in is set outside a test run (#1465)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_TEST_BYPASS", "true");

    const guarded = buildGuardedApp(createRateLimiter({ limit: 1, windowMs: 60_000 }));

    expect((await request(guarded).get("/guarded")).status).toBe(200);
    expect((await request(guarded).get("/guarded")).status).toBe(429);
  });
});
