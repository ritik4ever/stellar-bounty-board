import { describe, expect, it } from "vitest";
import {
  extractGithubPrRepo,
  validateGithubPrUrlForRepo,
  validatePrUrlForRepo,
} from "../src/validation/prUrl";

describe("validateGithubPrUrlForRepo (GitHub-only)", () => {
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

describe("validatePrUrlForRepo (multi-provider)", () => {
  it("accepts a GitHub PR for the bounty repo", () => {
    expect(() => validatePrUrlForRepo("https://github.com/owner/repo/pull/123", "owner/repo")).not.toThrow();
  });

  it("accepts a GitLab MR for the bounty repo", () => {
    expect(() => validatePrUrlForRepo("https://gitlab.com/owner/repo/-/merge_requests/45", "owner/repo")).not.toThrow();
  });

  it("accepts a Bitbucket PR for the bounty repo", () => {
    expect(() => validatePrUrlForRepo("https://bitbucket.org/owner/repo/pull-requests/78", "owner/repo")).not.toThrow();
  });

  it("rejects a valid URL for a different repo", () => {
    expect(() => validatePrUrlForRepo("https://github.com/owner/other/pull/123", "owner/repo")).toThrow(/must match bounty repo/i);
  });

  it("rejects an unsupported provider URL", () => {
    expect(() => validatePrUrlForRepo("https://example.com/owner/repo/pull/1", "owner/repo")).toThrow(/valid GitHub pull request, GitLab merge request, or Bitbucket pull request/i);
  });

  it("rejects a non-URL string", () => {
    expect(() => validatePrUrlForRepo("not-a-url", "owner/repo")).toThrow();
  });
});
