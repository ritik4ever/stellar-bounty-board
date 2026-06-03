import type { Bounty, BountyLabel } from '../types';

/**
 * Fetch completed bounties for a given wallet address to extract skill labels.
 * In a real implementation, this would call an API endpoint.
 */
async function getCompletedBounties(walletAddress: string): Promise<Bounty[]> {
  // Placeholder: In production, replace with actual API call
  // e.g., return fetch(`/api/bounties?completedBy=${walletAddress}`).then(res => res.json());
  return [];
}

/**
 * Fetch all open bounties from the backend.
 */
async function getOpenBounties(): Promise<Bounty[]> {
  // Placeholder: In production, replace with actual API call
  // e.g., return fetch('/api/bounties?status=open').then(res => res.json());
  return [];
}

/**
 * Extract unique labels from an array of bounties.
 */
function extractLabels(bounties: Bounty[]): string[] {
  const labelSet = new Set<string>();
  bounties.forEach((bounty) => {
    (bounty.labels || []).forEach((label: BountyLabel) => {
      if (typeof label === 'string') {
        labelSet.add(label);
      } else if (label.name) {
        labelSet.add(label.name);
      }
    });
  });
  return Array.from(labelSet);
}

/**
 * Calculate a relevance score for a bounty based on label overlap with user's skills.
 */
function calculateRelevanceScore(bounty: Bounty, userLabels: string[]): number {
  const bountyLabelNames = (bounty.labels || []).map((label: BountyLabel) =>
    typeof label === 'string' ? label : label.name
  );
  const matchingLabels = bountyLabelNames.filter((name: string) =>
    userLabels.includes(name)
  );
  return matchingLabels.length;
}

/**
 * Get personalized bounty recommendations for a wallet.
 * Returns up to 3 bounties sorted by relevance (label overlap) or highest value as fallback.
 */
export async function getRecommendedBounties(
  walletAddress?: string | null
): Promise<Bounty[]> {
  if (!walletAddress) {
    return [];
  }

  const completedBounties = await getCompletedBounties(walletAddress);
  const userLabels = extractLabels(completedBounties);
  const openBounties = await getOpenBounties();

  if (userLabels.length === 0) {
    // Fallback: return highest-value open bounties
    return openBounties
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 3);
  }

  // Score and sort open bounties by label overlap
  const scored = openBounties.map((bounty) => ({
    bounty,
    score: calculateRelevanceScore(bounty, userLabels),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Return top 3 with highest score, break ties by value
  return scored
    .slice(0, 3)
    .sort((a, b) => b.bounty.value - a.bounty.value)
    .map((item) => item.bounty);
}
