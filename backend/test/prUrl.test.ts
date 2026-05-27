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

  it("rejects malformed GitHub PR URL variants", () => {
    const malformedUrls = [
      "https://github.com/owner/repo-name/pull/42/",
      "https://github.com/owner/repo-name/pull/42?tab=files",
      "https://github.com/owner/repo-name/pull/42#discussion_r1",
      "https://github.com:443/owner/repo-name/pull/42",
    ];

    for (const malformedUrl of malformedUrls) {
      expect(extractGitHubPrRepo(malformedUrl)).toBeNull();
      expect(() => assertGitHubPrMatchesRepo(malformedUrl, "owner/repo-name")).toThrow(
        /Submission URL must follow format/,
      );
    }
  });

  it("accepts a matching private-style GitHub repository URL", () => {
    expect(() =>
      assertGitHubPrMatchesRepo("https://github.com/private-owner/private-repo/pull/7", "private-owner/private-repo"),
    ).not.toThrow();
  });
});
