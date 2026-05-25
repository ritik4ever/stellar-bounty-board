import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { tokenAmountToUsd, xlmToUsd, resetXlmToUsdCache } from "./utils";

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

  it("falls back to the last known XLM/USD rate when refresh fails", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stellar: { usd: 0.1 } }),
      });
      await expect(xlmToUsd(100)).resolves.toBe("$10.00");

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      fetchMock.mockRejectedValueOnce(new Error("network unavailable"));

      await expect(xlmToUsd(50)).resolves.toBe("$5.00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("converts USDC amounts at a 1:1 USD rate without fetching XLM prices", async () => {
    await expect(tokenAmountToUsd(21.8, "USDC")).resolves.toBe("$21.80");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
