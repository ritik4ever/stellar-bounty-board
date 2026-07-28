import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import { rateLimit } from "express-rate-limit";

const WINDOW_MS = 60_000;
const READ_MAX = 120;
const OVER_LIMIT = READ_MAX + 10;

const EXEMPT_PATHS = new Set(["/api/health", "/api/health/deep", "/worker/health", "/api/metrics"]);

function isExemptPath(req: express.Request): boolean {
  return EXEMPT_PATHS.has(req.path);
}

function buildReadLimiter() {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: READ_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ipv6Subnet: 56,
    skip: (req: express.Request) => req.method !== "GET" || isExemptPath(req),
    handler: (_req: express.Request, res: express.Response) => {
      res.setHeader("Retry-After", String(Math.ceil(WINDOW_MS / 1000)));
      res.status(429).json({ error: "Too many requests. Please retry later." });
    },
  });
}

describe("Rate-limit bypass for exempt endpoints", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    // Register exempt routes BEFORE the rate limiter (matching production ordering)
    app.get("/api/health", (_req, res) => {
      res.status(200).json({ status: "ok" });
    });
    app.get("/api/health/deep", (_req, res) => {
      res.status(200).json({ status: "ok" });
    });
    app.get("/worker/health", (_req, res) => {
      res.status(200).json({ status: "ok" });
    });
    app.get("/api/metrics", (_req, res) => {
      res.status(200).send("metrics data");
    });

    // Apply a real rate limiter AFTER exempt routes
    app.use(buildReadLimiter());
  });

  it("GET /api/health bypasses rate limiting under high load", async () => {
    const promises = Array.from({ length: OVER_LIMIT }, () =>
      request(app).get("/api/health"),
    );
    const responses = await Promise.all(promises);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });

  it("GET /api/health/deep bypasses rate limiting under high load", async () => {
    const promises = Array.from({ length: OVER_LIMIT }, () =>
      request(app).get("/api/health/deep"),
    );
    const responses = await Promise.all(promises);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });

  it("GET /worker/health bypasses rate limiting under high load", async () => {
    const promises = Array.from({ length: OVER_LIMIT }, () =>
      request(app).get("/worker/health"),
    );
    const responses = await Promise.all(promises);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });

  it("GET /api/metrics bypasses rate limiting under high load", async () => {
    const promises = Array.from({ length: OVER_LIMIT }, () =>
      request(app).get("/api/metrics"),
    );
    const responses = await Promise.all(promises);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });
});

describe("Rate limiting is active for regular endpoints", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    // Register an exempt route (to match production setup)
    app.get("/api/health", (_req, res) => {
      res.status(200).json({ status: "ok" });
    });

    // Apply a real rate limiter
    app.use(buildReadLimiter());

    // Register a regular (non-exempt) endpoint AFTER the rate limiter
    app.get("/api/regular-endpoint", (_req, res) => {
      res.status(200).json({ ok: true });
    });
  });

  it("a regular GET endpoint is rate-limited after exceeding the limit", async () => {
    let got429 = false;

    const promises = Array.from({ length: OVER_LIMIT }, () =>
      request(app).get("/api/regular-endpoint"),
    );
    const responses = await Promise.all(promises);

    for (const res of responses) {
      if (res.status === 429) {
        got429 = true;
        expect(res.body).toHaveProperty("error");
        expect(res.body.error).toContain("Too many requests");
        expect(res.headers).toHaveProperty("retry-after");
        break;
      }
    }

    expect(got429).toBe(true);
  });

  it("passes requests below the rate limit successfully", async () => {
    const promises = Array.from({ length: READ_MAX - 10 }, () =>
      request(app).get("/api/regular-endpoint"),
    );
    const responses = await Promise.all(promises);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });
});
