import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINTAINER, OTHER_ACCOUNT } from "./fixtures";

let storeFile: string;
let originalFetch: typeof globalThis.fetch;

const mockPoolQuery = vi.fn();
let mockPoolStats = {
  totalCount: 5,
  idleCount: 3,
  waitingCount: 0,
};

vi.mock("pg", () => {
  return {
    Pool: vi.fn().mockImplementation(() => ({
      query: (...args: any[]) => mockPoolQuery(...args),
      get totalCount() {
        return mockPoolStats.totalCount;
      },
      get idleCount() {
        return mockPoolStats.idleCount;
      },
      get waitingCount() {
        return mockPoolStats.waitingCount;
      },
      end: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-deep-health-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, "[]", "utf8");
  process.env.BOUNTY_STORE_PATH = storeFile;
  process.env.MAINTAINER_PUBLIC_KEY = MAINTAINER;
  process.env.ARBITER_ADDRESS = OTHER_ACCOUNT;
  process.env.SOROBAN_CONTRACT_ID = "CCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/stellar_test";
  originalFetch = globalThis.fetch;
  mockPoolQuery.mockReset();
  mockPoolQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });
  mockPoolStats = {
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
  };
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.MAINTAINER_PUBLIC_KEY;
  delete process.env.ARBITER_ADDRESS;
  delete process.env.SOROBAN_CONTRACT_ID;
  delete process.env.CONTRACT_ID;
  delete process.env.SOROBAN_RPC_URL;
  delete process.env.DATABASE_URL;
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

function mockHealthyRpc(): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result: { status: "healthy" } }),
  }) as typeof fetch;
}

async function getApp() {
  const { app } = await import("../src/app");
  return app;
}

describe("GET /api/health/deep", () => {
  it("returns 200 with all components up when dependencies are healthy", async () => {
    mockHealthyRpc();
    const app = await getApp();

    const res = await request(app).get("/api/health/deep").expect(200);

    expect(res.body.overall).toBe("up");
    expect(res.body.components.store).toBe("up");
    expect(res.body.components.soroban).toBe("up");
    expect(res.body.components.contract).toBe("up");
    expect(res.body.components.auth).toBe("up");
    expect(res.body.components.database).toEqual({
      status: "up",
      latencyMs: expect.any(Number),
      pool: {
        totalCount: 5,
        idleCount: 3,
        waitingCount: 0,
        activeCount: 2,
      },
    });
    expect(res.body.timestamp).toBeDefined();
  });

  it("returns 503 when auth configuration is missing", async () => {
    mockHealthyRpc();
    delete process.env.MAINTAINER_PUBLIC_KEY;
    delete process.env.ARBITER_ADDRESS;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.overall).toBe("down");
    expect(res.body.components.auth).toBe("down");
  });

  it("returns 503 when contract id is missing", async () => {
    mockHealthyRpc();
    delete process.env.SOROBAN_CONTRACT_ID;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.components.contract).toBe("down");
    expect(res.body.overall).toBe("down");
  });

  it("returns 503 when soroban rpc is unreachable", async () => {
    mockHealthyRpc();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error")) as typeof fetch;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.components.soroban).toBe("down");
    expect(res.body.overall).toBe("down");
  });

  it("returns 503 when store is not readable JSON", async () => {
    mockHealthyRpc();
    fs.writeFileSync(storeFile, "not-json", "utf8");
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.components.store).toBe("down");
  });

  it("returns 503 when DATABASE_URL is not configured", async () => {
    mockHealthyRpc();
    delete process.env.DATABASE_URL;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.overall).toBe("down");
    expect(res.body.components.database.status).toBe("down");
    expect(res.body.components.database.error).toBe("DATABASE_URL is not configured");
  });

  it("is excluded from rate limiting", async () => {
    mockHealthyRpc();
    process.env.NODE_ENV = "production";
    vi.resetModules();

    const app = await getApp();

    for (let i = 0; i < 130; i++) {
      await request(app).get("/api/health/deep").expect(200);
    }
  });
});

describe("GET /api/health/deep — Soroban RPC chaos (#908)", () => {
  it("marks soroban degraded on a simulated connection timeout, while other checks stay independently healthy", async () => {
    // Simulate what a real fetch abort (RPC_TIMEOUT_MS exceeded) produces,
    // without waiting out the real timeout.
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new DOMException("The operation was aborted.", "AbortError")) as typeof fetch;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.overall).toBe("down");
    expect(res.body.components.soroban).toBe("down");
    expect(res.body.components.store).toBe("up");
    expect(res.body.components.contract).toBe("up");
    expect(res.body.components.auth).toBe("up");
    expect(res.body.components.database.status).toBe("up");
  });

  it("marks soroban degraded on a simulated RPC error response, while other checks stay independently healthy", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "Service Unavailable" }),
    }) as typeof fetch;
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.overall).toBe("down");
    expect(res.body.components.soroban).toBe("down");
    expect(res.body.components.store).toBe("up");
    expect(res.body.components.contract).toBe("up");
    expect(res.body.components.auth).toBe("up");
    expect(res.body.components.database.status).toBe("up");
  });

  it("fully recovers once the simulated RPC outage ends", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("connection refused")) as typeof fetch;
    vi.resetModules();

    const app = await getApp();
    const duringOutage = await request(app).get("/api/health/deep").expect(503);
    expect(duringOutage.body.components.soroban).toBe("down");
    expect(duringOutage.body.overall).toBe("down");

    // End the simulated outage: RPC responds healthy again.
    mockHealthyRpc();
    vi.resetModules();

    const appRecovered = await getApp();
    const afterRecovery = await request(appRecovered).get("/api/health/deep").expect(200);

    expect(afterRecovery.body.overall).toBe("up");
    expect(afterRecovery.body.components.store).toBe("up");
    expect(afterRecovery.body.components.soroban).toBe("up");
    expect(afterRecovery.body.components.contract).toBe("up");
    expect(afterRecovery.body.components.auth).toBe("up");
    expect(afterRecovery.body.components.database.status).toBe("up");
  });
});

describe("GET /api/health/deep — Postgres Database dependency check", () => {
  it("marks database down on simulated connection/query failure, while other checks stay healthy", async () => {
    mockHealthyRpc();
    mockPoolQuery.mockRejectedValue(new Error("connection refused"));
    vi.resetModules();

    const app = await getApp();
    const res = await request(app).get("/api/health/deep").expect(503);

    expect(res.body.overall).toBe("down");
    expect(res.body.components.database.status).toBe("down");
    expect(res.body.components.database.error).toBe("connection refused");
    expect(res.body.components.database.latencyMs).toBeTypeOf("number");
    expect(res.body.components.database.pool).toEqual({
      totalCount: 5,
      idleCount: 3,
      waitingCount: 0,
      activeCount: 2,
    });
    expect(res.body.components.store).toBe("up");
    expect(res.body.components.soroban).toBe("up");
    expect(res.body.components.contract).toBe("up");
    expect(res.body.components.auth).toBe("up");
  });

  it("marks database down on simulated query timeout, while other checks stay healthy", async () => {
    mockHealthyRpc();
    // Simulate query hanging past timeout
    mockPoolQuery.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10_000)));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.resetModules();

    const app = await getApp();
    const reqPromise = request(app).get("/api/health/deep");

    await vi.advanceTimersByTimeAsync(5_100);

    const res = await reqPromise;
    expect(res.status).toBe(503);
    expect(res.body.overall).toBe("down");
    expect(res.body.components.database.status).toBe("down");
    expect(res.body.components.database.error).toContain("timed out");
    expect(res.body.components.store).toBe("up");
    expect(res.body.components.soroban).toBe("up");
    expect(res.body.components.contract).toBe("up");
    expect(res.body.components.auth).toBe("up");

    vi.useRealTimers();
  });

  it("fully recovers once simulated database outage ends", async () => {
    mockHealthyRpc();
    mockPoolQuery.mockRejectedValue(new Error("connection terminated"));
    vi.resetModules();

    const app = await getApp();
    const duringOutage = await request(app).get("/api/health/deep").expect(503);
    expect(duringOutage.body.components.database.status).toBe("down");
    expect(duringOutage.body.overall).toBe("down");

    // End simulated database outage
    mockPoolQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    vi.resetModules();

    const appRecovered = await getApp();
    const afterRecovery = await request(appRecovered).get("/api/health/deep").expect(200);

    expect(afterRecovery.body.overall).toBe("up");
    expect(afterRecovery.body.components.database.status).toBe("up");
    expect(afterRecovery.body.components.database.latencyMs).toBeTypeOf("number");
    expect(afterRecovery.body.components.database.pool).toEqual({
      totalCount: 5,
      idleCount: 3,
      waitingCount: 0,
      activeCount: 2,
    });
    expect(afterRecovery.body.components.store).toBe("up");
    expect(afterRecovery.body.components.soroban).toBe("up");
    expect(afterRecovery.body.components.contract).toBe("up");
    expect(afterRecovery.body.components.auth).toBe("up");
  });
});

