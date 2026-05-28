import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  debounce,
  filterBounties,
  getActiveRewardLabel,
  getContributorMetrics,
  getRepoMetrics,
  getRewardBounds,
  getUniqueRepos,
  getXlmRate,
  resetXlmToUsdCache,
  sortBounties,
  xlmToUsd,
} from "./utils";
import type { Bounty } from "./types";

const contributor = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY";

function makeBounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: "BNTY-1",
    repo: "ritik4ever/stellar-bounty-board",
    issueNumber: 1,
    title: "Frontend coverage",
    summary: "Add tests",
    maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    contributor: undefined,
    tokenSymbol: "XLM",
    amount: 100,
    labels: [{ name: "frontend", color: "ededed" }],
    status: "open",
    createdAt: 10,
    deadlineAt: 100,
    version: 1,
    events: [],
    ...overrides,
  };
}

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

describe("bounty list utilities", () => {
  const bounties = [
    makeBounty({ id: "BNTY-1", repo: "alpha/repo", amount: 50, status: "open", createdAt: 1, deadlineAt: 100 }),
    makeBounty({ id: "BNTY-2", repo: "beta/repo", amount: 150, status: "reserved", createdAt: 2, deadlineAt: 50 }),
    makeBounty({ id: "BNTY-3", repo: "alpha/repo", amount: 250, status: "released", createdAt: 3, deadlineAt: 200, contributor }),
  ];

  it("returns unique repositories and per-repo metrics", () => {
    expect(getUniqueRepos(bounties)).toEqual(["alpha/repo", "beta/repo"]);
    expect(getRepoMetrics(bounties, "alpha/repo")).toMatchObject({
      totalBounties: 2,
      openBounties: 1,
      releasedBounties: 1,
      totalFunded: 300,
      totalPaidOut: 250,
    });
  });

  it("filters by status, repository, search, and reward range", () => {
    const result = filterBounties(bounties, {
      statusFilter: "open",
      repoFilter: "alpha/repo",
      searchQuery: "front",
      minReward: "25",
      maxReward: "75",
      sortOption: "newest",
      sortDirection: "desc",
    });

    expect(result.map((bounty) => bounty.id)).toEqual(["BNTY-1"]);
  });

  it("sorts and formats reward ranges", () => {
    expect(getRewardBounds(bounties)).toEqual({ lowest: 50, highest: 250 });
    expect(getRewardBounds([])).toEqual({ lowest: 0, highest: 0 });
    expect(sortBounties(bounties, { option: "deadline-soonest", direction: "asc" }).map((bounty) => bounty.id)).toEqual([
      "BNTY-2",
      "BNTY-1",
      "BNTY-3",
    ]);
    expect(sortBounties(bounties, { option: "reward-high", direction: "desc" })[0].amount).toBe(250);
    expect(getActiveRewardLabel("", "", { lowest: 50, highest: 250 })).toBe("All rewards");
    expect(getActiveRewardLabel("", "100", { lowest: 50, highest: 250 })).toBe("Up to 100 XLM");
    expect(getActiveRewardLabel("100", "", { lowest: 50, highest: 250 })).toBe("100+ XLM");
    expect(getActiveRewardLabel("75", "175", { lowest: 50, highest: 250 })).toBe("75 - 175 XLM");
  });

  it("summarizes contributor activity", () => {
    const metrics = getContributorMetrics(bounties, contributor);

    expect(metrics.filtered).toHaveLength(1);
    expect(metrics.countsByStatus.get("released")).toBe(1);
    expect(metrics.releasedTotalsByAsset.get("XLM")).toBe(250);
    expect(getContributorMetrics(bounties).filtered).toEqual([]);
  });
});

describe("async helpers", () => {
  it("debounces calls until the delay elapses", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced("first");
    debounced("second");
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledWith("second");
    vi.useRealTimers();
  });

  it("fetches and caches the live XLM rate", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.12 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getXlmRate()).resolves.toBe(0.12);
    await expect(getXlmRate()).resolves.toBe(0.12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
