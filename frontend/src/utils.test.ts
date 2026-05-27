import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  calculateDeadlineAt,
  formatAmount,
  getStatusAtDeadline,
  resetXlmToUsdCache,
  xlmToUsd,
} from "./utils";

describe("deadline and amount helpers", () => {
  it("computes a leap-year deadline on Feb 29", () => {
    const startsAt = Date.UTC(2024, 1, 28, 12, 0, 0);
    const deadlineAt = calculateDeadlineAt(startsAt, 1);

    expect(new Date(deadlineAt).toISOString()).toBe("2024-02-29T12:00:00.000Z");
  });

  it("keeps a zero-day deadline within the same day", () => {
    const startsAt = Date.UTC(2026, 4, 26, 9, 30, 0);
    const deadlineAt = calculateDeadlineAt(startsAt, 0);

    expect(new Date(deadlineAt).toISOString().slice(0, 10)).toBe("2026-05-26");
  });

  it("expires exactly at the deadline timestamp, not before it", () => {
    const deadlineAt = Date.UTC(2026, 4, 26, 17, 0, 0);

    expect(getStatusAtDeadline("open", deadlineAt, deadlineAt - 1)).toBe("open");
    expect(getStatusAtDeadline("open", deadlineAt, deadlineAt)).toBe("expired");
  });

  it("formats a zero XLM amount with seven decimals", () => {
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
