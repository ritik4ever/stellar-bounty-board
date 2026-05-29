import { describe, expect, it } from "vitest";
import { formatAmount, computeDeadline, isExpired } from "../src/utils";

// ─── formatAmount ────────────────────────────────────────────────────────────

describe("formatAmount", () => {
  it("formats zero with 7 decimal places", () => {
    expect(formatAmount(0, "XLM")).toBe("0.0000000 XLM");
  });

  it("formats a whole number with 7 decimal places", () => {
    expect(formatAmount(42, "XLM")).toBe("42.0000000 XLM");
  });

  it("formats a fractional amount with 7 decimal places", () => {
    expect(formatAmount(42.5, "XLM")).toBe("42.5000000 XLM");
  });

  it("formats very small amounts correctly", () => {
    expect(formatAmount(0.0000001, "XLM")).toBe("0.0000001 XLM");
  });

  it("uppercases the token symbol", () => {
    expect(formatAmount(10, "xlm")).toBe("10.0000000 XLM");
  });

  it("handles negative amounts", () => {
    expect(formatAmount(-5.5, "USDC")).toBe("-5.5000000 USDC");
  });
});

// ─── computeDeadline ─────────────────────────────────────────────────────────

describe("computeDeadline", () => {
  it("computes deadline correctly for deadlineDays=0 (same day)", () => {
    const createdAt = 1700000000; // some fixed timestamp
    const result = computeDeadline(createdAt, 0);
    expect(result).toBe(createdAt);
  });

  it("computes deadline correctly for deadlineDays=1", () => {
    const createdAt = 1700000000;
    const oneDay = 24 * 60 * 60;
    expect(computeDeadline(createdAt, 1)).toBe(createdAt + oneDay);
  });

  it("computes deadline correctly for deadlineDays=30", () => {
    const createdAt = 1700000000;
    const thirtyDays = 30 * 24 * 60 * 60;
    expect(computeDeadline(createdAt, 30)).toBe(createdAt + thirtyDays);
  });

  it("computes deadline on Feb 29 of a leap year correctly", () => {
    // Feb 29, 2024 00:00:00 UTC = 1709164800
    const feb29_2024 = 1709164800;
    const result = computeDeadline(feb29_2024, 1);
    // Should be Mar 1, 2024 00:00:00 UTC = 1709251200
    const expected = new Date(Date.UTC(2024, 2, 1, 0, 0, 0)).getTime() / 1000;
    expect(result).toBe(expected);
  });

  it("computes deadline across year boundary correctly", () => {
    // Dec 31, 2024 12:00:00 UTC
    const dec31_noon = Math.floor(new Date(Date.UTC(2024, 11, 31, 12, 0, 0)).getTime() / 1000);
    const result = computeDeadline(dec31_noon, 1);
    // Should be Jan 1, 2025 12:00:00 UTC
    const expected = Math.floor(new Date(Date.UTC(2025, 0, 1, 12, 0, 0)).getTime() / 1000);
    expect(result).toBe(expected);
  });

  it("handles fractional days by truncating to seconds", () => {
    const createdAt = 1700000000;
    // 0.5 days = 43200 seconds
    const result = computeDeadline(createdAt, 0.5);
    // The function uses integer multiplication, so 0.5 * 86400 = 43200
    expect(result).toBe(createdAt + 43200);
  });
});

// ─── isExpired ───────────────────────────────────────────────────────────────

describe("isExpired", () => {
  const DEADLINE = 1700000000;

  it("returns false for open bounty at deadlineAt - 1 second", () => {
    expect(isExpired(DEADLINE, "open", DEADLINE - 1)).toBe(false);
  });

  it("returns false for open bounty at exactly deadlineAt (not strictly greater)", () => {
    // The expiration check uses `now > deadlineAt`, so at exactly deadlineAt
    // the bounty is NOT expired yet.
    expect(isExpired(DEADLINE, "open", DEADLINE)).toBe(false);
  });

  it("returns true for open bounty at deadlineAt + 1 second", () => {
    expect(isExpired(DEADLINE, "open", DEADLINE + 1)).toBe(true);
  });

  it("returns false for reserved bounty at deadlineAt - 1 second", () => {
    expect(isExpired(DEADLINE, "reserved", DEADLINE - 1)).toBe(false);
  });

  it("returns true for reserved bounty at deadlineAt + 1 second", () => {
    expect(isExpired(DEADLINE, "reserved", DEADLINE + 1)).toBe(true);
  });

  it("returns false for submitted bounty even past deadline", () => {
    expect(isExpired(DEADLINE, "submitted", DEADLINE + 1000)).toBe(false);
  });

  it("returns false for released bounty even past deadline", () => {
    expect(isExpired(DEADLINE, "released", DEADLINE + 1000)).toBe(false);
  });

  it("returns false for expired status (already expired)", () => {
    expect(isExpired(DEADLINE, "expired", DEADLINE + 1000)).toBe(false);
  });

  it("returns false for refunded status", () => {
    expect(isExpired(DEADLINE, "refunded", DEADLINE + 1000)).toBe(false);
  });

  it("returns true for open bounty well past deadline", () => {
    expect(isExpired(DEADLINE, "open", DEADLINE + 86400)).toBe(true);
  });
});
