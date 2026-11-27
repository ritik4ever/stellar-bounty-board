import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { readLimiter, mutationLimiter } from "../src/utils";
import { getOperationalConfig } from "../src/config";

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

  it("does not rate limit in test environment (NODE_ENV=test)", async () => {
    // NODE_ENV is set to "test" by default in vitest
    // Send RATE_LIMIT_TEST_COUNT requests, they should all pass with 200 OK
    const config = getOperationalConfig();
    const promises = Array.from({ length: config.rateLimitTestCount }, () =>
      request(app).get("/test-read")
    );
    const responses = await Promise.all(promises);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });
});
