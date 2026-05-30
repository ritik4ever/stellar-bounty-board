import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { xlmToUsd, resetXlmToUsdCache, filterBounties, getUniqueTokenSymbols } from "./utils";
import type { FilterState } from "./constants";
import type { Bounty } from "./types";

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

function mockBounty(overrides: Partial<Bounty>): Bounty {
  return {
    id: "BNT-0001",
    repo: "acme/widget",
    issueNumber: 1,
    title: "Fix the widget",
    summary: "A task",
    maintainer: "GMAINTAINER",
    tokenSymbol: "XLM",
    amount: 100,
    labels: [],
    status: "open",
    createdAt: 1,
    deadlineAt: 2,
    ...overrides,
  } as Bounty;
}

const baseFilters: FilterState = {
  searchQuery: "",
  statusFilter: "all",
  minReward: "",
  maxReward: "",
  repoFilter: "",
  tokenFilter: "",
  sortOption: "newest",
  sortDirection: "desc",
};

const tokenBounties: Bounty[] = [
  mockBounty({ id: "1", tokenSymbol: "XLM", status: "open" }),
  mockBounty({ id: "2", tokenSymbol: "USDC", status: "open" }),
  mockBounty({ id: "3", tokenSymbol: "XLM", status: "released" }),
  mockBounty({ id: "4", tokenSymbol: "usdc", status: "reserved" }), // lowercase
];

describe("getUniqueTokenSymbols (#293)", () => {
  it("returns distinct, uppercased, sorted token symbols", () => {
    expect(getUniqueTokenSymbols(tokenBounties)).toEqual(["USDC", "XLM"]);
  });

  it("returns an empty array for no bounties", () => {
    expect(getUniqueTokenSymbols([])).toEqual([]);
  });
});

describe("filterBounties — token filter (#293)", () => {
  it("filters to a single token (case-insensitive)", () => {
    const result = filterBounties(tokenBounties, { ...baseFilters, tokenFilter: "USDC" });
    expect(result.map((b) => b.id).sort()).toEqual(["2", "4"]);
  });

  it("combines token and status filters with AND logic", () => {
    const result = filterBounties(tokenBounties, {
      ...baseFilters,
      tokenFilter: "XLM",
      statusFilter: "open",
    });
    expect(result.map((b) => b.id)).toEqual(["1"]);
  });

  it("returns all bounties when the token filter is empty ('All Tokens')", () => {
    expect(filterBounties(tokenBounties, baseFilters)).toHaveLength(4);
  });
});
