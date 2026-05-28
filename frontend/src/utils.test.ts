import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { FilterState } from "./constants";
import { Bounty } from "./types";
import { debounce, filterBounties, xlmToUsd, resetXlmToUsdCache } from "./utils";

const defaultFilters = (searchQuery = ""): FilterState => ({
  searchQuery,
  statusFilter: "all",
  minReward: "",
  maxReward: "",
  repoFilter: "",
  sortOption: "newest",
  sortDirection: "desc",
});

const bountyFixture = (overrides: Partial<Bounty>): Bounty => ({
  id: "bounty-1",
  repo: "stellar/bounty-board",
  issueNumber: 291,
  title: "Add search input",
  summary: "Make bounties easier to discover from the board.",
  maintainer: "maintainer",
  tokenSymbol: "XLM",
  amount: 100,
  labels: [{ name: "frontend", color: "0f766e" }],
  status: "open",
  createdAt: 1,
  deadlineAt: 2,
  version: 1,
  events: [],
  ...overrides,
});

describe("filterBounties", () => {
  const bounties = [
    bountyFixture({
      id: "title-match",
      title: "Add advanced search input",
      repo: "stellar/bounty-board",
      summary: "Filter the issue list.",
    }),
    bountyFixture({
      id: "repo-match",
      title: "Improve cards",
      repo: "ritik4ever/stellar-bounty-board",
      summary: "Polish the list layout.",
    }),
    bountyFixture({
      id: "summary-match",
      title: "Tidy empty state",
      repo: "stellar/ui",
      summary: "Show relevant rewards when contributors search.",
    }),
  ];

  it("matches title, repo, and summary case-insensitively", () => {
    expect(filterBounties(bounties, defaultFilters("ADVANCED")).map((bounty) => bounty.id)).toEqual([
      "title-match",
    ]);
    expect(filterBounties(bounties, defaultFilters("RITIK4EVER")).map((bounty) => bounty.id)).toEqual([
      "repo-match",
    ]);
    expect(filterBounties(bounties, defaultFilters("contributors search")).map((bounty) => bounty.id)).toEqual([
      "summary-match",
    ]);
  });

  it("returns every bounty when the search query is empty", () => {
    expect(filterBounties(bounties, defaultFilters("   "))).toHaveLength(3);
  });

  it("returns an empty list when no bounty matches the search query", () => {
    expect(filterBounties(bounties, defaultFilters("not-here"))).toEqual([]);
  });
});

describe("debounce", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits 300ms and only invokes the latest search callback", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debouncedCallback = debounce(callback, 300);

    debouncedCallback("s");
    debouncedCallback("se");
    debouncedCallback("sea");

    vi.advanceTimersByTime(299);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("sea");
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
