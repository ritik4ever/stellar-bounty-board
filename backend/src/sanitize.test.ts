/**
 * sanitize.test.ts
 *
 * Unit tests for the sanitizeText helper and the Zod createBountySchema.
 * Run with:  npx vitest run  (from backend/)
 */

import { describe, expect, it } from "vitest";
import { sanitizeText } from "./sanitize";
import { createBountySchema } from "./schemas";

// ---------------------------------------------------------------------------
// sanitizeText
// ---------------------------------------------------------------------------

describe("sanitizeText", () => {
  it("trims leading and trailing whitespace", () => {
    expect(sanitizeText("  hello  ")).toBe("hello");
    expect(sanitizeText("\t Fix bug \n")).toBe("Fix bug");
  });

  it("encodes < and > (HTML tags)", () => {
    expect(sanitizeText("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("encodes & (ampersand)", () => {
    expect(sanitizeText("Rocks & Rolls")).toBe("Rocks &amp; Rolls");
  });

  it("encodes double quotes", () => {
    expect(sanitizeText('He said "hello"')).toBe("He said &quot;hello&quot;");
  });

  it("encodes single quotes", () => {
    expect(sanitizeText("It's fine")).toBe("It&#x27;s fine");
  });

  it("encodes a full XSS payload", () => {
    const payload = `<img src=x onerror="alert('xss')">`;
    const encoded = sanitizeText(payload);
    expect(encoded).toBe(
      "&lt;img src=x onerror=&quot;alert(&#x27;xss&#x27;)&quot;&gt;"
    );
    // Must not contain any raw < or >
    expect(encoded).not.toContain("<");
    expect(encoded).not.toContain(">");
  });

  it("leaves plain text unchanged (apart from trim)", () => {
    expect(sanitizeText("Fix the login bug")).toBe("Fix the login bug");
  });

  it("handles an empty string after trimming", () => {
    // trim only — empty string passes through (schema enforces min length)
    expect(sanitizeText("   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// createBountySchema — title and summary sanitization via Zod transform
// ---------------------------------------------------------------------------

describe("createBountySchema – title sanitization", () => {
  const base = {
    issueUrl: "https://github.com/owner/repo/issues/1",
    reward: "100",
  };

  it("trims whitespace from title", () => {
    const result = createBountySchema.parse({
      ...base,
      title: "  Fix login bug  ",
      summary: "Details here",
    });
    expect(result.title).toBe("Fix login bug");
  });

  it("HTML-encodes <script> in title before storage", () => {
    const result = createBountySchema.parse({
      ...base,
      title: "<script>alert(1)</script>",
      summary: "Normal summary",
    });
    expect(result.title).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result.title).not.toContain("<");
  });

  it("rejects an empty title", () => {
    expect(() =>
      createBountySchema.parse({ ...base, title: "", summary: "ok" })
    ).toThrow();
  });

  it("rejects a title longer than 200 characters", () => {
    expect(() =>
      createBountySchema.parse({
        ...base,
        title: "a".repeat(201),
        summary: "ok",
      })
    ).toThrow();
  });
});

describe("createBountySchema – summary sanitization", () => {
  const base = {
    issueUrl: "https://github.com/owner/repo/issues/2",
    title: "Normal title",
    reward: "50",
  };

  it("trims whitespace from summary", () => {
    const result = createBountySchema.parse({
      ...base,
      summary: "   Fix the thing.   ",
    });
    expect(result.summary).toBe("Fix the thing.");
  });

  it("HTML-encodes <img onerror> payload in summary before storage", () => {
    const result = createBountySchema.parse({
      ...base,
      summary: `<img src=x onerror="alert('xss')">`,
    });
    expect(result.summary).not.toContain("<");
    expect(result.summary).not.toContain(">");
    expect(result.summary).toContain("&lt;img");
  });

  it("encodes & in summary", () => {
    const result = createBountySchema.parse({
      ...base,
      summary: "Fast & reliable",
    });
    expect(result.summary).toBe("Fast &amp; reliable");
  });

  it("rejects an empty summary", () => {
    expect(() =>
      createBountySchema.parse({ ...base, summary: "" })
    ).toThrow();
  });

  it("rejects a summary longer than 2000 characters", () => {
    expect(() =>
      createBountySchema.parse({ ...base, summary: "x".repeat(2001) })
    ).toThrow();
  });
});

describe("createBountySchema – other fields unaffected", () => {
  it("rejects an invalid issueUrl", () => {
    expect(() =>
      createBountySchema.parse({
        issueUrl: "not-a-url",
        title: "ok",
        summary: "ok",
        reward: "10",
      })
    ).toThrow();
  });

  it("rejects a non-numeric reward", () => {
    expect(() =>
      createBountySchema.parse({
        issueUrl: "https://github.com/o/r/issues/1",
        title: "ok",
        summary: "ok",
        reward: "abc",
      })
    ).toThrow();
  });

  it("accepts a valid complete payload", () => {
    const result = createBountySchema.parse({
      issueUrl: "https://github.com/o/r/issues/3",
      title: "Patch XSS",
      summary: "Encode user input before storage",
      reward: "75",
      urgency: "high",
    });
    expect(result.urgency).toBe("high");
    expect(result.reward).toBe("75");
  });
});