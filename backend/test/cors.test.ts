import cors from "cors";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCorsOptions,
  createCorsPreflightGuard,
} from "../src/middleware/corsOptions";

const PRODUCTION_ORIGIN = "https://bounty-board.vercel.app";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  delete process.env.NODE_ENV;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.CORS_ORIGINS;
});

function createTestApp() {
  const app = express();
  app.use(createCorsPreflightGuard());
  app.use(cors(buildCorsOptions()));
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "stellar-bounty-board-api" });
  });
  return app;
}

describe("CORS production allowlist (#256)", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = PRODUCTION_ORIGIN;
  });

  it("allows preflight from an allowed production origin", async () => {
    const app = createTestApp();

    const res = await request(app)
      .options("/api/health")
      .set("Origin", PRODUCTION_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).not.toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBe(PRODUCTION_ORIGIN);
  });

  it("returns 403 on preflight from an unrecognized production origin", async () => {
    const app = createTestApp();

    const res = await request(app)
      .options("/api/health")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "GET")
      .expect(403);

    expect(res.body.error).toMatch(/not allowed by CORS policy/i);
  });

  it("allows GET requests from an allowed production origin", async () => {
    const app = createTestApp();

    const res = await request(app)
      .get("/api/health")
      .set("Origin", PRODUCTION_ORIGIN)
      .expect(200);

    expect(res.body.status).toBe("ok");
    expect(res.headers["access-control-allow-origin"]).toBe(PRODUCTION_ORIGIN);
  });

  it("restricts origins to ALLOWED_ORIGINS in production", async () => {
    const app = createTestApp();

    const res = await request(app)
      .get("/api/health")
      .set("Origin", "https://other.example.com")
      .expect(200);

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("CORS development defaults (#256)", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "development";
  });

  it("allows preflight from arbitrary origins when unset (wildcard default)", async () => {
    const app = createTestApp();

    const res = await request(app)
      .options("/api/health")
      .set("Origin", "http://localhost:9999")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).not.toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:9999");
  });

  it("honors CORS_ORIGINS explicit dev allowlist", async () => {
    process.env.CORS_ORIGINS = "http://localhost:3000";
    const app = createTestApp();

    const allowed = await request(app)
      .options("/api/health")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");

    expect(allowed.status).not.toBe(403);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");

    const blocked = await request(app)
      .options("/api/health")
      .set("Origin", "http://localhost:9999")
      .set("Access-Control-Request-Method", "GET");

    expect(blocked.status).not.toBe(403);
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("falls back to ALLOWED_ORIGINS in development when CORS_ORIGINS is unset", async () => {
    process.env.ALLOWED_ORIGINS = "http://localhost:3000";
    const app = createTestApp();

    const res = await request(app)
      .get("/api/health")
      .set("Origin", "http://localhost:3000")
      .expect(200);

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("treats CORS_ORIGINS=* as permissive in development", async () => {
    process.env.CORS_ORIGINS = "*";
    const app = createTestApp();

    const res = await request(app)
      .get("/api/health")
      .set("Origin", "http://custom.dev:4321")
      .expect(200);

    expect(res.headers["access-control-allow-origin"]).toBe("http://custom.dev:4321");
  });
});

describe("resolveCorsConfig unit helpers", () => {
  it("parseOriginAllowlist splits comma-separated values", async () => {
    const { parseOriginAllowlist } = await import("../src/middleware/corsOptions");
    const allowlist = parseOriginAllowlist(
      "https://a.example.com, https://b.example.com ,",
    );

    expect([...allowlist]).toEqual(["https://a.example.com", "https://b.example.com"]);
  });
});
