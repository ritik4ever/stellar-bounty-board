import { describe, expect, it } from "vitest";
import { extractGithubPrRepo, validateGithubPrUrlForRepo } from "../src/validation/prUrl";

describe("PR URL repo validation", () => {
  it("accepts a GitHub PR for the bounty repo", async () => {
    await expect(
      validateGithubPrUrlForRepo("https://github.com/owner/repo/pull/123", "owner/repo"),
    ).resolves.not.toThrow();
    expect(extractGithubPrRepo("https://github.com/owner/repo/pull/123")).toBe("owner/repo");
  });

  it("rejects a GitHub PR for a different repo", async () => {
    await expect(
      validateGithubPrUrlForRepo("https://github.com/owner/other/pull/123", "owner/repo"),
    ).rejects.toThrow(/must match bounty repo owner\/repo/i);
  });

  it("rejects non-GitHub URLs", async () => {
    await expect(
      validateGithubPrUrlForRepo("https://gitlab.com/owner/repo/pull/123", "owner/repo"),
    ).rejects.toThrow(/github\.com/i);
  });

  it("accepts private GitHub repository URL patterns when the repo matches", async () => {
    await expect(
      validateGithubPrUrlForRepo("https://github.com/private-org/private-repo/pull/7", "private-org/private-repo"),
    ).resolves.not.toThrow();
  });
});
