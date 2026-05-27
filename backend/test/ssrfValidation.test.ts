import { describe, expect, it } from "vitest";

import { createBountySchema, submitBountySchema } from "../src/validation/schemas";
import { CONTRIBUTOR, validCreateBody } from "./fixtures";

describe("SSRF-safe bounty input validation", () => {
  it("accepts a valid GitHub pull request submission URL", () => {
    const result = submitBountySchema.safeParse({
      contributor: CONTRIBUTOR,
      submissionUrl: "https://github.com/owner/repo/pull/123",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a private IP submission URL", () => {
    const result = submitBountySchema.safeParse({
      contributor: CONTRIBUTOR,
      submissionUrl: "https://127.0.0.1/internal/pull/1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a localhost submission URL", () => {
    const result = submitBountySchema.safeParse({
      contributor: CONTRIBUTOR,
      submissionUrl: "https://localhost/owner/repo/pull/1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a data URI submission URL", () => {
    const result = submitBountySchema.safeParse({
      contributor: CONTRIBUTOR,
      submissionUrl: "data:text/plain,https://github.com/owner/repo/pull/1",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a repo in owner/repo format", () => {
    const result = createBountySchema.safeParse(validCreateBody);

    expect(result.success).toBe(true);
  });

  it("rejects repo values that look like URLs", () => {
    const result = createBountySchema.safeParse({
      ...validCreateBody,
      repo: "https://127.0.0.1/private/repo",
    });

    expect(result.success).toBe(false);
  });
});
