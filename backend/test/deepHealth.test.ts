import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINTAINER, OTHER_ACCOUNT } from "./fixtures";

let storeFile: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-deep-health-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  process.env.MAINTAINER_PUBLIC_KEY = MAINTAINER;
  process.env.ARBITER_ADDRESS = OTHER_ACCOUNT;
  process.env.SOROBAN_CONTRACT_ID = "CCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  process.env.SENDGRID_API_KEY = "SG.test-api-key";
  originalFetch = globalThis.fetch;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.MAINTAINER_PUBLIC_KEY;
  delete process.env.ARBITER_ADDRESS;
  delete process.env.SOROBAN_CONTRACT_ID;
  delete process.env.CONTRACT_ID;
  delete process.env.SOROBAN_RPC_URL;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.NODE_ENV;
  globalThis.fetch = originalFetch;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* best-effort */
  }
  try {
    fs.unlinkSync(`${storeFile}.health-probe`);
  } catch {
    /* best-effort */
  }
});

function mockHealthyServices(): void {
  globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes("api.sendgrid.com")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ scopes: ["mail.send"] }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: { status: "healthy" } }),
    };
  }) as typeof fetch;
}

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

describe("GET /api/health/deep", () => {
  it("returns 200 with all components up when dependencies are healthy", async () => {
    mockHealthyServices();
    const app = await getApp();

    const res = await request(app).get("/api/health/deep").expect(200);

    expect(res.body.overall).toBe("up");
    expect(res.body.components).toEqual({
      store: "up",
      soroban: "up",
      contract: "up",
      auth: "up",
      sendgrid: "up",
    });
    expect(res.body.timestamp).toBeDefined();
  });

  it("returns 503 when auth configuration is missing", async () => {
    mockHealthyServices();
    delete process.env.MAINTAINER_PUBLIC_KEY;
    delete process.env.ARBITER_ADDRESS;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.overall).toBe("down");
    expect(res.body.components.auth).toBe("down");
  });

  it("returns 503 when contract id is missing", async () => {
    mockHealthyServices();
    delete process.env.SOROBAN_CONTRACT_ID;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.components.contract).toBe("down");
    expect(res.body.overall).toBe("down");
  });

  it("returns 503 when soroban rpc is unreachable", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.sendgrid.com")) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      throw new Error("network error");
    }) as typeof fetch;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.components.soroban).toBe("down");
    expect(res.body.components.sendgrid).toBe("up");
    expect(res.body.overall).toBe("down");
  });

  it("returns 503 when store is not readable JSON", async () => {
    mockHealthyServices();
    fs.writeFileSync(storeFile, "not-json", "utf8");
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.components.store).toBe("down");
  });

  it("returns 503 when SENDGRID_API_KEY is missing", async () => {
    mockHealthyServices();
    delete process.env.SENDGRID_API_KEY;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.components.sendgrid).toBe("down");
    expect(res.body.overall).toBe("down");
  });

  it("is excluded from rate limiting", async () => {
    mockHealthyServices();
    process.env.NODE_ENV = "production";
    vi.resetModules();

    const app = await getApp();

    for (let i = 0; i < 130; i++) {
      await request(app).get("/api/health/deep").expect(200);
    }
  });
});

describe("GET /api/health/deep — SendGrid chaos & dependency checks", () => {
  it("marks sendgrid down on a simulated SendGrid outage/error while other checks stay healthy", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.sendgrid.com")) {
        return { ok: false, status: 503, json: async () => ({ error: "Service Unavailable" }) };
      }
      return { ok: true, status: 200, json: async () => ({ result: { status: "healthy" } }) };
    }) as typeof fetch;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.overall).toBe("down");
    expect(res.body.components.sendgrid).toBe("down");
    expect(res.body.components.store).toBe("up");
    expect(res.body.components.soroban).toBe("up");
    expect(res.body.components.contract).toBe("up");
    expect(res.body.components.auth).toBe("up");
  });

  it("marks sendgrid down on a simulated SendGrid timeout without hanging the health check", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.sendgrid.com")) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return { ok: true, status: 200, json: async () => ({ result: { status: "healthy" } }) };
    }) as typeof fetch;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.overall).toBe("down");
    expect(res.body.components.sendgrid).toBe("down");
    expect(res.body.components.store).toBe("up");
    expect(res.body.components.soroban).toBe("up");
    expect(res.body.components.contract).toBe("up");
    expect(res.body.components.auth).toBe("up");
  });

  it("fully recovers once the simulated SendGrid outage ends", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.sendgrid.com")) {
        throw new Error("Network connection lost");
      }
      return { ok: true, status: 200, json: async () => ({ result: { status: "healthy" } }) };
    }) as typeof fetch;
    vi.resetModules();

    const app = await getApp();
    const duringOutage = await request(app).get("/api/health/deep").expect(503);
    expect(duringOutage.body.components.sendgrid).toBe("down");
    expect(duringOutage.body.overall).toBe("down");

    // End outage
    mockHealthyServices();
    vi.resetModules();

    const appRecovered = await getApp();
    const afterRecovery = await request(appRecovered).get("/api/health/deep").expect(200);
    expect(afterRecovery.body.overall).toBe("up");
    expect(afterRecovery.body.components.sendgrid).toBe("up");
  });
});

describe("GET /api/health/deep — Soroban RPC chaos (#908)", () => {
  it("marks soroban degraded on a simulated connection timeout, while other checks stay independently healthy", async () => {
    // Simulate what a real fetch abort (RPC_TIMEOUT_MS exceeded) produces,
    // without waiting out the real timeout.
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.sendgrid.com")) {
        return { ok: true, status: 200, json: async () => ({ scopes: [] }) };
      }
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.overall).toBe("down");
    expect(res.body.components.soroban).toBe("down");
    expect(res.body.components.store).toBe("up");
    expect(res.body.components.contract).toBe("up");
    expect(res.body.components.auth).toBe("up");
    expect(res.body.components.sendgrid).toBe("up");
  });

  it("marks soroban degraded on a simulated RPC error response, while other checks stay independently healthy", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.sendgrid.com")) {
        return { ok: true, status: 200, json: async () => ({ scopes: [] }) };
      }
      return { ok: false, status: 503, json: async () => ({ error: "Service Unavailable" }) };
    }) as typeof fetch;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.overall).toBe("down");
    expect(res.body.components.soroban).toBe("down");
    expect(res.body.components.store).toBe("up");
    expect(res.body.components.contract).toBe("up");
    expect(res.body.components.auth).toBe("up");
    expect(res.body.components.sendgrid).toBe("up");
  });

  it("fully recovers once the simulated RPC outage ends", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("api.sendgrid.com")) {
        return { ok: true, status: 200, json: async () => ({ scopes: [] }) };
      }
      throw new Error("connection refused");
    }) as typeof fetch;
    vi.resetModules();

    const app = await getApp();
    const duringOutage = await request(app).get("/api/health/deep").expect(503);
    expect(duringOutage.body.components.soroban).toBe("down");
    expect(duringOutage.body.overall).toBe("down");

    // End the simulated outage: RPC responds healthy again.
    mockHealthyServices();
    vi.resetModules();

    const appRecovered = await getApp();
    const afterRecovery = await request(appRecovered).get("/api/health/deep").expect(200);

    expect(afterRecovery.body.overall).toBe("up");
    expect(afterRecovery.body.components).toEqual({
      store: "up",
      soroban: "up",
      contract: "up",
      auth: "up",
      sendgrid: "up",
    });
  });
});

