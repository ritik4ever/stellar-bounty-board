import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractGithubPrRepo,
  validateGithubPrUrlForRepo,
} from "../src/validation/prUrl";

// validateGithubPrUrlForRepo verifies PR existence against the live GitHub
// API (post #717). Stub fetch so these tests are hermetic and deterministic.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.github.com/repos/")) {
        // A "Closes #N" body lets the issue-reference check pass for any N.
        return {
          ok: true,
          status: 200,
          json: async () => ({ body: "Closes #1" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch in prUrl test: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PR URL repo validation", () => {
  it("accepts a GitHub PR for the bounty repo", async () => {
    await expect(
      validateGithubPrUrlForRepo(
        "https://github.com/owner/repo/pull/123",
        "owner/repo",
      ),
    ).resolves.toBeUndefined();
    expect(extractGithubPrRepo("https://github.com/owner/repo/pull/123")).toBe(
      "owner/repo",
    );
  });

  it("rejects a GitHub PR for a different repo", async () => {
    await expect(
      validateGithubPrUrlForRepo(
        "https://github.com/owner/other/pull/123",
        "owner/repo",
      ),
    ).rejects.toThrow(/must match bounty repo owner\/repo/i);
  });

  it("rejects non-GitHub URLs", async () => {
    await expect(
      validateGithubPrUrlForRepo(
        "https://gitlab.com/owner/repo/pull/123",
        "owner/repo",
      ),
    ).rejects.toThrow(/github\.com/i);
  });

  it("accepts private GitHub repository URL patterns when the repo matches", async () => {
    await expect(
      validateGithubPrUrlForRepo(
        "https://github.com/private-org/private-repo/pull/7",
        "private-org/private-repo",
      ),
    ).resolves.toBeUndefined();
  });
});
