import { describe, expect, it, vi } from "vitest";
import {
  formatAmount,
  computeDeadline,
  isExpired,
  isLeapYear,
} from "../src/utils";

describe("isLeapYear", () => {
  it("returns true for leap years", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2400)).toBe(true);
  });

  it("returns false for non-leap years", () => {
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2025)).toBe(false);
  });
});

describe("computeDeadline", () => {
  it("computes leap year deadline correctly (Feb 29)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-28T00:00:00Z"));

    const deadline = computeDeadline(1);
    const expected = new Date("2024-02-29T00:00:00Z").getTime();

    expect(Math.abs(deadline - expected)).toBeLessThan(1000);
    vi.useRealTimers();
  });

  it("same-day deadline (deadlineDays=0) produces a deadline within the same day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));

    const deadline = computeDeadline(0);
    const now = Date.now();

    expect(deadline).toBe(now);
    vi.useRealTimers();
  });

  it("throws for negative deadlineDays", () => {
    expect(() => computeDeadline(-1)).toThrow("deadlineDays must be non-negative");
  });
});

describe("isExpired", () => {
  it("deadlineAt - 1ms is not expired", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const deadlineAt = now + 1000;
    vi.setSystemTime(deadlineAt - 1);

    expect(isExpired(deadlineAt)).toBe(false);
    vi.useRealTimers();
  });

  it("deadlineAt exactly is expired", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const deadlineAt = now + 1000;
    vi.setSystemTime(deadlineAt);

    expect(isExpired(deadlineAt)).toBe(true);
    vi.useRealTimers();
  });

  it("past deadline is expired", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const deadlineAt = now - 1;
    vi.setSystemTime(now);

    expect(isExpired(deadlineAt)).toBe(true);
    vi.useRealTimers();
  });
});

describe("formatAmount", () => {
  it("formats zero XLM correctly", () => {
    expect(formatAmount(0, "XLM")).toBe("0.0000000 XLM");
  });

  it("formats positive XLM correctly", () => {
    expect(formatAmount(42.5, "XLM")).toBe("42.5000000 XLM");
  });

  it("formats USDC with 6 decimal places", () => {
    expect(formatAmount(100, "USDC")).toBe("100.000000 USDC");
  });

  it("formats small amounts correctly", () => {
    expect(formatAmount(0.0000001, "XLM")).toBe("0.0000001 XLM");
  });

  it("defaults to 7 decimals for unknown tokens", () => {
    expect(formatAmount(5, "SOL")).toBe("5.0000000 SOL");
  });
});
