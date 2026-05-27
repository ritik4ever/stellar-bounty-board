import { Bounty, BountyStatus } from "./types";
import { FilterState } from "./constants";


// Simple debounce function for search
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

export function getUniqueRepos(bounties: Bounty[]): string[] {
  const repos = new Set(bounties.map((bounty) => bounty.repo));
  return Array.from(repos).sort();
}

export function getRepoMetrics(bounties: Bounty[], repo: string) {
  const repoBounties = bounties.filter((bounty) => bounty.repo === repo);
  const openBounties = repoBounties.filter((bounty) => bounty.status === "open");
  const reservedBounties = repoBounties.filter((bounty) => bounty.status === "reserved");
  const submittedBounties = repoBounties.filter((bounty) => bounty.status === "submitted");
  const releasedBounties = repoBounties.filter((bounty) => bounty.status === "released");
  const refundedBounties = repoBounties.filter((bounty) => bounty.status === "refunded");
  const expiredBounties = repoBounties.filter((bounty) => bounty.status === "expired");

  return {
    totalBounties: repoBounties.length,
    openBounties: openBounties.length,
    reservedBounties: reservedBounties.length,
    submittedBounties: submittedBounties.length,
    releasedBounties: releasedBounties.length,
    refundedBounties: refundedBounties.length,
    expiredBounties: expiredBounties.length,
    totalFunded: repoBounties.reduce((sum, bounty) => sum + bounty.amount, 0),
    totalPaidOut: releasedBounties.reduce((sum, bounty) => sum + bounty.amount, 0),
  };
}

export function filterBounties(bounties: Bounty[], filters: FilterState): Bounty[] {
  return bounties.filter((bounty) => {
    // Status filter
    if (filters.statusFilter !== "all" && bounty.status !== filters.statusFilter) {
      return false;
    }

    // Repo filter
    if (filters.repoFilter.trim() !== "" && bounty.repo !== filters.repoFilter) {
      return false;
    }

    // Search filter
    if (filters.searchQuery.trim() !== "") {
      const searchLower = filters.searchQuery.toLowerCase();
      const matchesSearch =
        bounty.repo.toLowerCase().includes(searchLower) ||
        bounty.title.toLowerCase().includes(searchLower) ||
        bounty.labels.some((label) => label.name.toLowerCase().includes(searchLower)) ||
        bounty.status.toLowerCase().includes(searchLower);
      
      if (!matchesSearch) {
        return false;
      }
    }

    // Reward range filter
    const minReward = filters.minReward === "" ? 0 : Number(filters.minReward);
    const maxReward = filters.maxReward === "" ? Infinity : Number(filters.maxReward);
    
    if (bounty.amount < minReward || bounty.amount > maxReward) {
      return false;
    }

    return true;
  });
}

export function getRewardBounds(bounties: Bounty[]): { lowest: number; highest: number } {
  if (bounties.length === 0) {
    return { lowest: 0, highest: 0 };
  }
  
  const amounts = bounties.map((bounty) => bounty.amount);
  return {
    lowest: Math.min(...amounts),
    highest: Math.max(...amounts),
  };
}

export type SortOption = "reward-high" | "reward-low" | "deadline-soonest" | "deadline-latest" | "newest" | "oldest";

export interface SortState {
  option: SortOption;
  direction: "asc" | "desc";
}

export function sortBounties(bounties: Bounty[], sort: SortState): Bounty[] {
  const sorted = [...bounties].sort((a, b) => {
    let comparison = 0;
    
    switch (sort.option) {
      case "reward-high":
        comparison = a.amount - b.amount;
        break;
      case "reward-low":
        comparison = a.amount - b.amount;
        break;
      case "deadline-soonest":
        comparison = a.deadlineAt - b.deadlineAt;
        break;
      case "deadline-latest":
        comparison = a.deadlineAt - b.deadlineAt;
        break;
      case "newest":
        comparison = a.createdAt - b.createdAt;
        break;
      case "oldest":
        comparison = a.createdAt - b.createdAt;
        break;
    }
    
    // Apply direction
    return sort.direction === "asc" ? comparison : -comparison;
  });
  
  return sorted;
}

export function getActiveRewardLabel(
  minReward: string,
  maxReward: string,
  bounds: { lowest: number; highest: number }
): string {
  const min = minReward === "" ? bounds.lowest : Number(minReward);
  const max = maxReward === "" ? bounds.highest : Number(maxReward);
  
  if (min === bounds.lowest && max === bounds.highest) {
    return "All rewards";
  }
  
  if (min === bounds.lowest) {
    return `Up to ${max} XLM`;
  }
  
  if (max === bounds.highest) {
    return `${min}+ XLM`;
  }
  
  return `${min} - ${max} XLM`;
}

export { xlmToUsd, resetXlmToUsdCache } from "./xlmUsd";

export function getContributorMetrics(bounties: Bounty[], contributorAddress?: string) {
  if (!contributorAddress) {
    return {
      contributor: undefined,
      countsByStatus: new Map<BountyStatus, number>(),
      releasedTotalsByAsset: new Map<string, number>(),
      filtered: [],
    };
  }

  const contributorBounties = bounties.filter(
    (bounty) => bounty.contributor === contributorAddress
  );

  const countsByStatus = new Map<BountyStatus, number>();
  const releasedTotalsByAsset = new Map<string, number>();

  contributorBounties.forEach((bounty) => {
    // Count by status
    countsByStatus.set(
      bounty.status,
      (countsByStatus.get(bounty.status) || 0) + 1
    );

    // Sum released amounts by asset
    if (bounty.status === "released") {
      const asset = bounty.tokenSymbol;
      releasedTotalsByAsset.set(
        asset,
        (releasedTotalsByAsset.get(asset) || 0) + bounty.amount
      );
    }
  });

  return {
    contributor: contributorAddress,
    countsByStatus,
    releasedTotalsByAsset,
    filtered: contributorBounties,
  };
}

let cachedRate: number | null = null;
let cacheTimestamp: number = 0;
let pendingRequest: Promise<number | null> | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches the current XLM/USD rate from CoinGecko with a 5-minute cache.
 */
export async function getXlmRate(): Promise<number | null> {
  const now = Date.now();
  if (cachedRate !== null && now - cacheTimestamp < CACHE_DURATION) {
    return cachedRate;
  }

  if (pendingRequest) return pendingRequest;

  pendingRequest = (async () => {
    try {
      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd"
      );
      if (!response.ok) throw new Error("API response not ok");
      const data = await response.json();
      cachedRate = data.stellar.usd;
      cacheTimestamp = Date.now();
      return cachedRate;
    } catch (error) {
      console.error("Failed to fetch XLM/USD rate:", error);
      // Fallback to last known rate if available
      return cachedRate;
    } finally {
      pendingRequest = null;
    }
  })();

  return pendingRequest;
}