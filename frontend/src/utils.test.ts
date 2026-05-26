import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { xlmToUsd, resetXlmToUsdCache, txHashLink } from "./utils";

describe("txHashLink", () => {
  it("builds a Stellar Expert testnet link and truncated display", () => {
    const hash = "a".repeat(64);
    const result = txHashLink(hash);
    expect(result.href).toBe(`https://stellar.expert/explorer/testnet/tx/${hash}`);
    expect(result.display).toBe(`${hash.slice(0, 8)}...${hash.slice(-8)}`);
  });

  it("truncates a real Stellar tx hash to first 8 + last 8 chars", () => {
    const hash = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const result = txHashLink(hash);
    expect(result.display).toBe("abcdef01...23456789");
    expect(result.display.length).toBe(19); // 8 + 3 dots + 8
  });

  it("returns full hash when 16 chars or shorter and trims whitespace", () => {
    const result = txHashLink("  abcd1234  ");
    expect(result.display).toBe("abcd1234");
    expect(result.href).toBe("https://stellar.expert/explorer/testnet/tx/abcd1234");
  });

  it("URL-encodes special characters in the hash", () => {
    const result = txHashLink("hash with spaces");
    expect(result.href).toBe("https://stellar.expert/explorer/testnet/tx/hash%20with%20spaces");
    expect(result.display).toBe("hash with spaces");
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
