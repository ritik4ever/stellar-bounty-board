import { describe, expect, it } from "vitest";
import {
  CORRELATION_ID_PATTERN,
  correlationFields,
  getCorrelationId,
  newCorrelationId,
  normalizeCorrelationId,
  runWithCorrelationId,
} from "../src/correlation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("correlation ids (#1457)", () => {
  it("mints a fresh UUID v4 for every call", () => {
    const first = newCorrelationId();
    const second = newCorrelationId();
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(first).not.toBe(second);
  });

  it("accepts well-formed ids (trimmed) and rejects everything else", () => {
    expect(normalizeCorrelationId("abc-123")).toBe("abc-123");
    expect(normalizeCorrelationId("  abc-123  ")).toBe("abc-123");
    expect(normalizeCorrelationId("a".repeat(128))).toBe("a".repeat(128));

    for (const bad of [
      undefined,
      null,
      "",
      "a".repeat(129),
      "abc 123",
      "abc_123",
      "abc\nlevel=error",
      42,
      {},
    ]) {
      expect(normalizeCorrelationId(bad)).toBeUndefined();
    }
  });

  it("exposes the active id only inside a correlated context, across awaits", async () => {
    expect(getCorrelationId()).toBeUndefined();

    await runWithCorrelationId("req-1", async () => {
      expect(getCorrelationId()).toBe("req-1");
      await Promise.resolve();
      expect(getCorrelationId()).toBe("req-1");

      await runWithCorrelationId("req-2", async () => {
        expect(getCorrelationId()).toBe("req-2");
      });

      expect(getCorrelationId()).toBe("req-1");
    });

    expect(getCorrelationId()).toBeUndefined();
  });

  it("builds log fields from the active context, or an explicit id", () => {
    expect(correlationFields()).toEqual({});

    runWithCorrelationId("req-3", () => {
      expect(correlationFields()).toEqual({ correlationId: "req-3" });
    });

    expect(correlationFields("explicit")).toEqual({ correlationId: "explicit" });
  });

  it("keeps the pattern aligned with the request-id format", () => {
    expect(CORRELATION_ID_PATTERN.test("abc-123")).toBe(true);
    expect(CORRELATION_ID_PATTERN.test("abc_123")).toBe(false);
  });
});
