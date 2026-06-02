import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

describe("Open Issues feed", () => {
  let originalFetch: any;

  beforeEach(() => {
    vi.resetModules();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("caches GitHub response and sets Cache-Control", async () => {
    const issue = { number: 1, title: "Fix loading", labels: [{ name: "help wanted" }], body: "Summary\n\nDetails" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (_: string) => "60" },
      json: async () => [issue],
    });
    // @ts-expect-error - inject global
    globalThis.fetch = fetchMock;

    const { app } = await import("../src/app");

    const res1 = await request(app).get("/api/open-issues").expect(200);
    expect(Array.isArray(res1.body.data)).toBe(true);
    expect(res1.headers["cache-control"]).toBe("max-age=600");

    const res2 = await request(app).get("/api/open-issues").expect(200);
    expect(Array.isArray(res2.body.data)).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves stale cached response when rate-limited", async () => {
    const issue = { number: 2, title: "Add feature", labels: [{ name: "enhancement" }], body: "Summary" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: (_: string) => "60" }, json: async () => [issue] })
      .mockResolvedValueOnce({ ok: false, status: 403, headers: { get: (_: string) => "0" }, json: async () => ({ message: "rate limit" }) });

    // @ts-expect-error - inject global
    globalThis.fetch = fetchMock;

    const { app } = await import("../src/app");

    const first = await request(app).get("/api/open-issues").expect(200);
    expect(first.body.data.length).toBe(1);

    const second = await request(app).get("/api/open-issues").expect(200);
    // second call should return cached value
    expect(second.body.data.length).toBe(1);

    const health = await request(app).get("/api/health/deep").expect(200);
    expect(["stale", "rate-limited", "up"]).toContain(health.body.openIssuesFeed);
  });
});
