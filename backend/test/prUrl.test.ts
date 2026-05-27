import { describe, expect, it } from "vitest";
import { assertGitHubPrMatchesRepo, extractGitHubPrRepo } from "../src/validation/prUrl";

describe("GitHub PR URL validation", () => {
  it("extracts the repository from a valid GitHub PR URL", () => {
    expect(extractGitHubPrRepo("https://github.com/owner/repo-name/pull/42")).toBe("owner/repo-name");
  });

  it("rejects a PR URL from the wrong repository", () => {
    expect(() =>
      assertGitHubPrMatchesRepo("https://github.com/other-owner/other-repo/pull/42", "owner/repo-name"),
    ).toThrow(/owner\/repo-name/);
  });

  it("rejects a non-GitHub PR URL", () => {
    expect(extractGitHubPrRepo("https://gitlab.com/owner/repo-name/-/merge_requests/42")).toBeNull();
  });

  it("accepts a matching private-style GitHub repository URL", () => {
    expect(() =>
      assertGitHubPrMatchesRepo("https://github.com/private-owner/private-repo/pull/7", "private-owner/private-repo"),
    ).not.toThrow();
  });
});
