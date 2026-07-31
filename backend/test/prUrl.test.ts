import { describe, expect, it } from "vitest";
import { extractGithubPrRepo, validateGithubPrUrlForRepo } from "../src/validation/prUrl";

describe("PR URL repo validation", () => {
  it("accepts a GitHub PR for the bounty repo", () => {
    expect(() => validateGithubPrUrlForRepo("https://github.com/owner/repo/pull/123", "owner/repo")).not.toThrow();
    expect(extractGithubPrRepo("https://github.com/owner/repo/pull/123")).toBe("owner/repo");
  });

  it("rejects a GitHub PR for a different repo", () => {
    expect(() => validateGithubPrUrlForRepo("https://github.com/owner/other/pull/123", "owner/repo")).toThrow(/must match bounty repo owner\/repo/i);
  });

  it("rejects non-GitHub URLs", () => {
    expect(() => validateGithubPrUrlForRepo("https://gitlab.com/owner/repo/pull/123", "owner/repo")).toThrow(/github\.com/i);
  });

  it("accepts private GitHub repository URL patterns when the repo matches", () => {
    expect(() => validateGithubPrUrlForRepo("https://github.com/private-org/private-repo/pull/7", "private-org/private-repo")).not.toThrow();
  });
});
