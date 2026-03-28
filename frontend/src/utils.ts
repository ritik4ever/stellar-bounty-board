import { Bounty, BountyStatus } from "./types";
import { FilterState } from "./constants";

export function filterBounties(bounties: Bounty[], filters: FilterState): Bounty[] {
  return bounties.filter((bounty) => {
    // Status filter
    if (filters.statusFilter !== "all" && bounty.status !== filters.statusFilter) {
      return false;
    }

    // Search filter
    if (filters.searchQuery.trim() !== "") {
      const searchLower = filters.searchQuery.toLowerCase();
      const matchesSearch =
        bounty.repo.toLowerCase().includes(searchLower) ||
        bounty.title.toLowerCase().includes(searchLower) ||
        bounty.labels.some((label) => label.toLowerCase().includes(searchLower)) ||
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
