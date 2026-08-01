import { describe, expect, it } from "vitest";
import {
  parseIssueUrl,
  parsePrUrl,
  extractRepoFromPrUrl,
  issueUrlSchema,
  submissionUrlSchema,
} from "../src/validation/urlParser";

describe("parseIssueUrl", () => {
  it("parses a GitHub issue URL", () => {
    const result = parseIssueUrl("https://github.com/owner/repo/issues/42");
    expect(result).toEqual({ provider: "github", owner: "owner", repo: "repo", issueNumber: 42 });
  });

  it("parses a GitLab issue URL (/-/issues/ path)", () => {
    const result = parseIssueUrl("https://gitlab.com/owner/repo/-/issues/42");
    expect(result).toEqual({ provider: "gitlab", owner: "owner", repo: "repo", issueNumber: 42 });
  });

  it("parses a GitLab issue URL (/issues/ path)", () => {
    const result = parseIssueUrl("https://gitlab.com/owner/repo/issues/42");
    expect(result).toEqual({ provider: "gitlab", owner: "owner", repo: "repo", issueNumber: 42 });
  });

  it("parses a Bitbucket issue URL", () => {
    const result = parseIssueUrl("https://bitbucket.org/owner/repo/issues/42");
    expect(result).toEqual({ provider: "bitbucket", owner: "owner", repo: "repo", issueNumber: 42 });
  });

  it("returns null for an unsupported provider", () => {
    expect(parseIssueUrl("https://example.com/owner/repo/issues/1")).toBeNull();
  });

  it("returns null for a non-URL string", () => {
    expect(parseIssueUrl("not-a-url")).toBeNull();
  });

  it("returns null when path is missing the issue segment", () => {
    expect(parseIssueUrl("https://github.com/owner/repo")).toBeNull();
  });

  it("returns null when issue number is not numeric", () => {
    expect(parseIssueUrl("https://github.com/owner/repo/issues/abc")).toBeNull();
  });

  it("handles repos with dots and hyphens (GitHub)", () => {
    const result = parseIssueUrl("https://github.com/my-org/my.repo/issues/7");
    expect(result).toEqual({ provider: "github", owner: "my-org", repo: "my.repo", issueNumber: 7 });
  });

  it("parses GitLab nested subgroup URL", () => {
    const result = parseIssueUrl("https://gitlab.com/group/subgroup/project/-/issues/15");
    expect(result).toEqual({ provider: "gitlab", owner: "group", repo: "subgroup/project", issueNumber: 15 });
  });
});

describe("parsePrUrl", () => {
  it("parses a GitHub pull request URL", () => {
    const result = parsePrUrl("https://github.com/owner/repo/pull/123");
    expect(result).toEqual({ provider: "github", owner: "owner", repo: "repo", prNumber: 123 });
  });

  it("parses a GitLab merge request URL (/-/merge_requests/ path)", () => {
    const result = parsePrUrl("https://gitlab.com/owner/repo/-/merge_requests/45");
    expect(result).toEqual({ provider: "gitlab", owner: "owner", repo: "repo", prNumber: 45 });
  });

  it("parses a Bitbucket pull request URL", () => {
    const result = parsePrUrl("https://bitbucket.org/owner/repo/pull-requests/78");
    expect(result).toEqual({ provider: "bitbucket", owner: "owner", repo: "repo", prNumber: 78 });
  });

  it("returns null for an unsupported provider", () => {
    expect(parsePrUrl("https://example.com/owner/repo/pull/1")).toBeNull();
  });

  it("returns null for a non-URL string", () => {
    expect(parsePrUrl("not-a-url")).toBeNull();
  });

  it("returns null when path is missing the PR segment", () => {
    expect(parsePrUrl("https://github.com/owner/repo")).toBeNull();
  });

  it("returns null when PR number is not numeric", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/abc")).toBeNull();
  });

  it("handles repos with dots and hyphens (GitHub)", () => {
    const result = parsePrUrl("https://github.com/my-org/my.repo/pull/7");
    expect(result).toEqual({ provider: "github", owner: "my-org", repo: "my.repo", prNumber: 7 });
  });

  it("parses GitLab nested subgroup MR URL", () => {
    const result = parsePrUrl("https://gitlab.com/group/subgroup/project/-/merge_requests/99");
    expect(result).toEqual({ provider: "gitlab", owner: "group", repo: "subgroup/project", prNumber: 99 });
  });

  it("parses Bitbucket pull request with large number", () => {
    const result = parsePrUrl("https://bitbucket.org/owner/repo/pull-requests/9999");
    expect(result).toEqual({ provider: "bitbucket", owner: "owner", repo: "repo", prNumber: 9999 });
  });
});

describe("extractRepoFromPrUrl", () => {
  it("extracts owner/repo from a GitHub PR URL", () => {
    expect(extractRepoFromPrUrl("https://github.com/owner/repo/pull/1")).toBe("owner/repo");
  });

  it("extracts owner/repo from a GitLab MR URL", () => {
    expect(extractRepoFromPrUrl("https://gitlab.com/owner/repo/-/merge_requests/1")).toBe("owner/repo");
  });

  it("extracts owner/repo from a Bitbucket PR URL", () => {
    expect(extractRepoFromPrUrl("https://bitbucket.org/owner/repo/pull-requests/1")).toBe("owner/repo");
  });

  it("returns undefined for unsupported provider", () => {
    expect(extractRepoFromPrUrl("https://example.com/owner/repo/pull/1")).toBeUndefined();
  });
});

describe("issueUrlSchema", () => {
  it("accepts a valid GitHub issue URL", () => {
    expect(() => issueUrlSchema.parse("https://github.com/owner/repo/issues/42")).not.toThrow();
  });

  it("accepts a valid GitLab issue URL", () => {
    expect(() => issueUrlSchema.parse("https://gitlab.com/owner/repo/-/issues/42")).not.toThrow();
  });

  it("accepts a valid Bitbucket issue URL", () => {
    expect(() => issueUrlSchema.parse("https://bitbucket.org/owner/repo/issues/42")).not.toThrow();
  });

  it("rejects an unsupported provider URL", () => {
    expect(() => issueUrlSchema.parse("https://example.com/owner/repo/issues/1")).toThrow();
  });

  it("rejects a non-URL string", () => {
    expect(() => issueUrlSchema.parse("not-a-url")).toThrow();
  });

  it("rejects a URL without an issue path", () => {
    expect(() => issueUrlSchema.parse("https://github.com/owner/repo")).toThrow();
  });
});

describe("submissionUrlSchema", () => {
  it("accepts a valid GitHub PR URL", () => {
    expect(() => submissionUrlSchema.parse("https://github.com/owner/repo/pull/123")).not.toThrow();
  });

  it("accepts a valid GitLab MR URL", () => {
    expect(() => submissionUrlSchema.parse("https://gitlab.com/owner/repo/-/merge_requests/45")).not.toThrow();
  });

  it("accepts a valid Bitbucket PR URL", () => {
    expect(() => submissionUrlSchema.parse("https://bitbucket.org/owner/repo/pull-requests/78")).not.toThrow();
  });

  it("rejects an unsupported provider URL", () => {
    expect(() => submissionUrlSchema.parse("https://example.com/owner/repo/pull/1")).toThrow();
  });

  it("rejects a non-URL string", () => {
    expect(() => submissionUrlSchema.parse("not-a-url")).toThrow();
  });

  it("rejects a URL without a PR segment", () => {
    expect(() => submissionUrlSchema.parse("https://github.com/owner/repo")).toThrow();
  });
});
