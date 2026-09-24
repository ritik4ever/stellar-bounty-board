import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

describe("Open Issues feed error handling", () => {
  let originalFetch: any;

  beforeEach(() => {
    vi.resetModules();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 502 when GitHub API fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    // @ts-expect-error - inject global
    globalThis.fetch = fetchMock;

    const { app } = await import("../src/app");

    const res = await request(app).get("/api/open-issues");
    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty("error");
  });
});
