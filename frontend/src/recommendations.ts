import { Bounty, BountyStatus } from "./types";

export interface BountyRecommendation {
  bounty: Bounty;
  reasons: string[];
  score: number;
}

export interface ContributorProfile {
  address?: string;
  completedLabels: string[];
  preferredRepos: string[];
  averageRewardRange: {
    min: number;
    max: number;
  };
}

const LABEL_WEIGHTS: Record<string, number> = {
  "help wanted": 0.8,
  "good first issue": 0.9,
  "beginner friendly": 0.9,
  "documentation": 0.7,
  "bug": 0.6,
  "enhancement": 0.6,
  "feature": 0.6,
  "backend": 0.5,
  "frontend": 0.5,
  "javascript": 0.4,
  "typescript": 0.4,
  "react": 0.4,
  "node.js": 0.4,
  "stellar": 0.3,
  "blockchain": 0.3,
};

const REPO_WEIGHT = 0.3;
const REWARD_WEIGHT = 0.2;
const STATUS_WEIGHTS: Record<BountyStatus, number> = {
  "open": 1.0,
  "reserved": 0.2,
  "submitted": 0.1,
  "released": 0,
  "refunded": 0,
  "expired": 0,
};

export function calculateRecommendationScore(
  bounty: Bounty,
  profile: ContributorProfile
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let totalScore = 0;
  let maxPossibleScore = 0;

  // Label-based scoring
  const labelScore = bounty.labels.reduce((acc, label) => {
    const normalizedLabel = label.toLowerCase();
    const weight = LABEL_WEIGHTS[normalizedLabel] || 0.1;
    
    if (profile.completedLabels.includes(normalizedLabel)) {
      reasons.push(`You've worked with "${label}" before`);
      return acc + weight * 1.5;
    }
    
    if (normalizedLabel === "good first issue" || normalizedLabel === "beginner friendly") {
      reasons.push(`Great for getting started`);
      return acc + weight;
    }
    
    return acc + weight;
  }, 0);
  
  totalScore += labelScore;
  maxPossibleScore += bounty.labels.length * 1.5;

  // Repository-based scoring
  if (profile.preferredRepos.some(repo => bounty.repo.includes(repo))) {
    totalScore += REPO_WEIGHT;
    maxPossibleScore += REPO_WEIGHT;
    reasons.push(`You're familiar with ${bounty.repo}`);
  }

  // Reward range scoring
  if (bounty.amount >= profile.averageRewardRange.min && bounty.amount <= profile.averageRewardRange.max) {
    totalScore += REWARD_WEIGHT;
    maxPossibleScore += REWARD_WEIGHT;
    reasons.push(`Reward matches your typical range`);
  }

  // Status weighting
  const statusWeight = STATUS_WEIGHTS[bounty.status] || 0;
  totalScore *= statusWeight;
  maxPossibleScore *= statusWeight;

  const normalizedScore = maxPossibleScore > 0 ? totalScore / maxPossibleScore : 0;

  return {
    score: Math.round(normalizedScore * 100) / 100,
    reasons: reasons.slice(0, 3), // Limit to top 3 reasons
  };
}

export function generateRecommendations(
  bounties: Bounty[],
  profile: ContributorProfile,
  limit: number = 5
): BountyRecommendation[] {
  const recommendations: BountyRecommendation[] = bounties
    .filter(bounty => bounty.status === "open")
    .map(bounty => {
      const { score, reasons } = calculateRecommendationScore(bounty, profile);
      return {
        bounty,
        score,
        reasons,
      };
    })
    .filter(rec => rec.score > 0.1) // Only include meaningful recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return recommendations;
}

export function createDefaultProfile(): ContributorProfile {
  return {
    completedLabels: [],
    preferredRepos: [],
    averageRewardRange: {
      min: 0,
      max: 1000,
    },
  };
}

export function updateProfileFromBounties(
  profile: ContributorProfile,
  completedBounties: Bounty[]
): ContributorProfile {
  const updatedProfile = { ...profile };

  // Update completed labels
  const newLabels = completedBounties
    .filter(bounty => bounty.status === "released")
    .flatMap(bounty => bounty.labels.map(label => label.toLowerCase()));
  
  updatedProfile.completedLabels = [...new Set([...profile.completedLabels, ...newLabels])];

  // Update preferred repos
  const newRepos = completedBounties
    .filter(bounty => bounty.status === "released")
    .map(bounty => bounty.repo.split('/')[0]); // Get owner part
  
  updatedProfile.preferredRepos = [...new Set([...profile.preferredRepos, ...newRepos])];

  // Update reward range
  const releasedBounties = completedBounties.filter(bounty => bounty.status === "released");
  if (releasedBounties.length > 0) {
    const amounts = releasedBounties.map(bounty => bounty.amount);
    updatedProfile.averageRewardRange = {
      min: Math.min(...amounts),
      max: Math.max(...amounts),
    };
  }

  return updatedProfile;
}
