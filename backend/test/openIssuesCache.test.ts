import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const githubIssue = {
  number: 365,
  title: "Add open issues caching",
  body: "Cache the GitHub API response for 10 minutes.\n\nMore detail follows.",
  labels: [{ name: "performance" }, { name: "api" }],
};

function mockGitHubResponse(body: unknown, init: ResponseInit = {}) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json", ...init.headers },
      ...init,
    }),
  );
}

describe("open issues GitHub feed cache", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.GITHUB_TOKEN;
  });

  it("caches GitHub API responses and sets a public max-age", async () => {
    const fetchMock = vi.fn(() => mockGitHubResponse([githubIssue]));
    vi.stubGlobal("fetch", fetchMock);

    const { app } = await import("../src/app");

    const first = await request(app).get("/api/open-issues").expect(200);
    const second = await request(app).get("/api/open-issues").expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.headers["cache-control"]).toBe("max-age=600");
    expect(second.headers["cache-control"]).toBe("max-age=600");
    expect(second.body.data).toEqual(first.body.data);
    expect(first.body.data[0]).toMatchObject({
      id: "#365",
      title: "Add open issues caching",
      labels: ["performance", "api"],
    });
  });

  it("uses GITHUB_TOKEN for authenticated GitHub requests", async () => {
    process.env.GITHUB_TOKEN = "ghp_test_token";
    const fetchMock = vi.fn(() => mockGitHubResponse([githubIssue]));
    vi.stubGlobal("fetch", fetchMock);

    const { app } = await import("../src/app");

    await request(app).get("/api/open-issues").expect(200);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_test_token",
        }),
      }),
    );
  });

  it("serves stale cached issues on GitHub rate limits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T00:00:00.000Z"));

    const staleIssue = { ...githubIssue, title: "Cached issue" };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => mockGitHubResponse([staleIssue]))
      .mockImplementationOnce(() =>
        mockGitHubResponse(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: {
              "Content-Type": "application/json",
              "X-RateLimit-Remaining": "0",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { app } = await import("../src/app");

    await request(app).get("/api/open-issues").expect(200);
    vi.setSystemTime(new Date("2026-05-28T00:11:00.000Z"));

    const rateLimited = await request(app).get("/api/open-issues").expect(200);
    const health = await request(app).get("/api/health/deep").expect(200);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rateLimited.body.data[0]).toMatchObject({
      id: "#365",
      title: "Cached issue",
    });
    expect(health.body.openIssuesFeed).toBe("rate-limited");
  });
});
