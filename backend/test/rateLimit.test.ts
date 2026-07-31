import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { readLimiter, mutationLimiter } from "../src/utils";

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
    // Send 200 requests, they should all pass with 200 OK
    const promises = Array.from({ length: 200 }, () =>
      request(app).get("/test-read")
    );
    const responses = await Promise.all(promises);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });
});
