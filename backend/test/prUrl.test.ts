import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractGithubPrRepo, validateGithubPrUrlForRepo } from "../src/validation/prUrl";

describe("PR URL repo validation", () => {
  beforeEach(() => {
    // Mock fetch to avoid real GitHub API calls
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ body: "Closes #123\nFixes #456" }),
    }));
  });

  it("accepts a GitHub PR for the bounty repo", async () => {
    await expect(validateGithubPrUrlForRepo("https://github.com/owner/repo/pull/123", "owner/repo", 123)).resolves.not.toThrow();
    expect(extractGithubPrRepo("https://github.com/owner/repo/pull/123")).toBe("owner/repo");
  });

  it("rejects a GitHub PR for a different repo", async () => {
    await expect(validateGithubPrUrlForRepo("https://github.com/owner/other/pull/123", "owner/repo")).rejects.toThrow(/must match bounty repo/i);
  });

  it("rejects non-GitHub URLs", async () => {
    await expect(validateGithubPrUrlForRepo("https://gitlab.com/owner/repo/pull/123", "owner/repo")).rejects.toThrow(
      "Submission URL must be from github.com",
    );
  });

  it("rejects a GitHub PR that does not reference the issue number", async () => {
    await expect(validateGithubPrUrlForRepo("https://github.com/owner/repo/pull/999", "owner/repo", 999)).rejects.toThrow(/does not reference issue/i);
  });
});
