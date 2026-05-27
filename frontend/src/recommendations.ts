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
  /** Declared skill tags the contributor has (e.g. ["React", "TypeScript", "Rust"]) */
  skills: string[];
}

/**
 * Score how well a bounty matches a contributor's declared skill tags.
 * Compares the contributor's skills against the bounty's labels and (optionally) tags.
 * Returns a normalized score between 0 and 1.
 *
 * @param bounty - The bounty to evaluate
 * @param skills - Array of contributor skill strings (case-insensitive)
 * @returns Normalized match score 0-1
 */


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

function normalizeTerms(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function getBountySkillTerms(bounty: Bounty): string[] {
  return normalizeTerms(bounty.labels.map((label) => label.name));
}

export function scoreMatch(bounty: Bounty, skills: string[]): number {
  const bountySkills = getBountySkillTerms(bounty);
  const contributorSkills = normalizeTerms(skills);

  if (bountySkills.length === 0 || contributorSkills.length === 0) {
    return 0;
  }

  const bountySkillSet = new Set(bountySkills);
  const contributorSkillSet = new Set(contributorSkills);
  let overlap = 0;

  for (const skill of bountySkillSet) {
    if (contributorSkillSet.has(skill)) {
      overlap += 1;
    }
  }

  const unionSize = new Set([...bountySkillSet, ...contributorSkillSet]).size;

  return unionSize > 0 ? Math.round((overlap / unionSize) * 100) / 100 : 0;
}

export function calculateRecommendationScore(
  bounty: Bounty,
  profile: ContributorProfile
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let totalScore = 0;
  let maxPossibleScore = 0;

  // Label-based scoring
  const labelScore = bounty.labels.reduce((acc, label) => {
    const normalizedLabel = label.name.toLowerCase();
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

  // Skill-matching score (Wave 4, #120)
  const skillScore = scoreMatch(bounty, profile.skills);
  if (skillScore > 0) {
    totalScore += skillScore * 0.5; // Weighted contribution up to 0.5
    maxPossibleScore += 0.5;
    reasons.push(`Matches ${Math.round(skillScore * 100)}% of your skills`);
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
    .sort((a, b) => {
      const scoreDifference = b.score - a.score;

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return scoreMatch(b.bounty, profile.completedLabels) - scoreMatch(a.bounty, profile.completedLabels);
    })
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
    skills: [],
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
    .flatMap(bounty => bounty.labels.map(label => label.name.toLowerCase()));

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

  // Infer skills from completed bounty labels (Wave 4, #120)
  const inferredSkills = new Set<string>(profile.skills);
  // Tech-related labels are likely skills (exclude generic labels)
  const skillKeywords = ["react", "typescript", "javascript", "rust", "python", "solidity",
    "stellar", "blockchain", "frontend", "backend", "docs", "testing", "node.js",
    "node", "api", "css", "html", "docker", "graphql", "web3", "smart-contract"];
  for (const label of newLabels) {
    if (skillKeywords.includes(label)) {
      // Capitalize first letter for consistency with KNOWN_TAGS
      const skill = label.charAt(0).toUpperCase() + label.slice(1);
      if (skill === "Docs") inferredSkills.add("Docs");
      else if (skill === "Node.js") inferredSkills.add("Node.js");
      else inferredSkills.add(skill);
    }
  }
  updatedProfile.skills = [...inferredSkills];

  return updatedProfile;
}
