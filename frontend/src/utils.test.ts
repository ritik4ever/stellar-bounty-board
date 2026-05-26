import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  computeDeadlineAt,
  formatAmount,
  isExpiredAt,
  xlmToUsd,
  resetXlmToUsdCache,
} from "./utils";

describe("deadline helpers", () => {
  it("computes a Feb 29 leap-year deadline correctly", () => {
    const createdAt = Date.UTC(2024, 1, 28, 12, 0, 0) / 1000;
    const expectedDeadline = Date.UTC(2024, 1, 29, 12, 0, 0) / 1000;

    expect(computeDeadlineAt(createdAt, 1)).toBe(expectedDeadline);
  });

  it("keeps zero-day deadlines within the same day", () => {
    const createdAt = Date.UTC(2026, 4, 25, 9, 30, 0) / 1000;

    const deadlineAt = computeDeadlineAt(createdAt, 0);

    expect(deadlineAt).toBe(createdAt);
    expect(new Date(deadlineAt * 1000).toDateString()).toBe(
      new Date(createdAt * 1000).toDateString()
    );
  });

  it("treats the exact deadline timestamp as expired", () => {
    const deadlineAt = 1_800_000_000;

    expect(isExpiredAt(deadlineAt, deadlineAt - 0.001)).toBe(false);
    expect(isExpiredAt(deadlineAt, deadlineAt)).toBe(true);
  });
});

describe("formatAmount", () => {
  it("formats zero amounts with seven decimal places", () => {
    expect(formatAmount(0, "XLM")).toBe("0.0000000 XLM");
  });
});

describe("xlmToUsd", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetXlmToUsdCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the XLM/USD rate and formats the amount", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.124 } }),
    });

    await expect(xlmToUsd(100)).resolves.toBe("$12.40");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
      { signal: expect.any(AbortSignal) }
    );
  });

  it("caches the fetched rate for subsequent conversions", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.2 } }),
    });

    await expect(xlmToUsd(10)).resolves.toBe("$2.00");
    await expect(xlmToUsd(25)).resolves.toBe("$5.00");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back gracefully when the rate fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network unavailable"));

    await expect(xlmToUsd(100)).resolves.toBe("USD unavailable");
  });
});
