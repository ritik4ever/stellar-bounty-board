import type { Bounty, BountyStatus } from './types';

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
export function scoreMatch(bounty: Bounty, skills: string[]): number {
  if (!skills || skills.length === 0) return 0;

  // Collect all text tokens from the bounty that could indicate skill relevance
  const bountyTokens: string[] = bounty.labels.map((l) => l.name.toLowerCase());

  // Also include bounty.tags if present (used in RecommendedBounties.tsx)
  if (Array.isArray((bounty as unknown as Record<string, unknown>).tags)) {
    const tags = (bounty as unknown as Record<string, unknown>).tags as string[];
    bountyTokens.push(...tags.map((t: string) => t.toLowerCase()));
  }

  // Include title and summary for broader matching
  bountyTokens.push(bounty.title.toLowerCase());
  bountyTokens.push(bounty.summary.toLowerCase());

  // Also split multi-word tokens for partial matching
  const expandedTokens = new Set<string>();
  for (const token of bountyTokens) {
    if (token.length === 0) continue;
    expandedTokens.add(token);
    // Split on non-alphanumeric boundaries to catch e.g. "react" in "react-native"
    for (const part of token.split(/[^a-z0-9#+.]+/)) {
      if (part.length >= 2) expandedTokens.add(part);
    }
  }

  // Normalize skills to lower case
  const normalizedSkills = skills.map((s) => s.toLowerCase().trim()).filter(Boolean);

  if (normalizedSkills.length === 0) return 0;

  // Count matching skills
  let matchCount = 0;
  for (const skill of normalizedSkills) {
    // Check exact match in any token
    if (expandedTokens.has(skill)) {
      matchCount++;
      continue;
    }
    // Check if skill is contained within any token (e.g. skill "js" in "node.js")
    for (const token of expandedTokens) {
      if (token.includes(skill) || skill.includes(token)) {
        matchCount++;
        break;
      }
    }
  }

  return normalizedSkills.length > 0 ? matchCount / normalizedSkills.length : 0;
}

const LABEL_WEIGHTS: Record<string, number> = {
  'help wanted': 0.8,
  'good first issue': 0.9,
  'beginner friendly': 0.9,
  documentation: 0.7,
  bug: 0.6,
  enhancement: 0.6,
  feature: 0.6,
  backend: 0.5,
  frontend: 0.5,
  javascript: 0.4,
  typescript: 0.4,
  react: 0.4,
  'node.js': 0.4,
  stellar: 0.3,
  blockchain: 0.3,
};

const REPO_WEIGHT = 0.3;
const REWARD_WEIGHT = 0.2;

const STATUS_WEIGHTS: Record<BountyStatus, number> = {
  open: 1.0,
  reserved: 0.2,
  submitted: 0.1,
  released: 0,
  refunded: 0,
  expired: 0,
};

export function calculateRecommendationScore(
  bounty: Bounty,
  profile: ContributorProfile
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let totalScore = 0;
  let maxPossibleScore = 0;

  const labelScore = bounty.labels.reduce((acc, label) => {
    const normalizedLabel = label.name.toLowerCase();
    const weight = LABEL_WEIGHTS[normalizedLabel] || 0.1;

    if (profile.completedLabels.includes(normalizedLabel)) {
      reasons.push(`You've worked with "${label.name}" before`);
      return acc + weight * 1.5;
    }

    if (normalizedLabel === 'good first issue' || normalizedLabel === 'beginner friendly') {
      reasons.push('Great for getting started');
      return acc + weight;
    }

    return acc + weight;
  }, 0);

  totalScore += labelScore;
  maxPossibleScore += bounty.labels.length * 1.5;

  if (profile.preferredRepos.some((repo) => bounty.repo.includes(repo))) {
    totalScore += REPO_WEIGHT;
    maxPossibleScore += REPO_WEIGHT;
    reasons.push(`You're familiar with ${bounty.repo}`);
  }

  if (
    bounty.amount >= profile.averageRewardRange.min &&
    bounty.amount <= profile.averageRewardRange.max
  ) {
    totalScore += REWARD_WEIGHT;
    maxPossibleScore += REWARD_WEIGHT;
    reasons.push('Reward matches your typical range');
  }

  const skillScore = scoreMatch(bounty, profile.skills);

  if (skillScore > 0) {
    totalScore += skillScore * 0.5;
    maxPossibleScore += 0.5;
    reasons.push(`Matches ${Math.round(skillScore * 100)}% of your skills`);
  }

  const statusWeight = STATUS_WEIGHTS[bounty.status] || 0;
  totalScore *= statusWeight;
  maxPossibleScore *= statusWeight;

  const normalizedScore = maxPossibleScore > 0 ? totalScore / maxPossibleScore : 0;

  return {
    score: Math.round(normalizedScore * 100) / 100,
    reasons: reasons.slice(0, 3),
  };
}

/**
 * Count how many bounty labels overlap with labels from completed work.
 */
export function countLabelOverlap(bounty: Bounty, completedLabels: string[]): number {
  if (completedLabels.length === 0) {
    return 0;
  }

  const completedSet = new Set(completedLabels.map((label) => label.toLowerCase()));

  return bounty.labels.filter((label) => completedSet.has(label.name.toLowerCase())).length;
}

function buildRecommendation(bounty: Bounty, overlap: number): BountyRecommendation {
  const reasons: string[] = [];

  if (overlap > 0) {
    reasons.push(
      overlap === 1
        ? 'Matches 1 label from your completed work'
        : `Matches ${overlap} labels from your completed work`
    );
  } else {
    reasons.push('Top open bounty by reward');
  }

  return {
    bounty,
    score: overlap > 0 ? Math.min(overlap / 3, 1) : 0.1,
    reasons,
  };
}

/**
 * Return the highest-value open bounties when the contributor has no history.
 */
export function getFallbackRecommendations(
  bounties: Bounty[],
  limit = 3
): BountyRecommendation[] {
  return bounties
    .filter((bounty) => bounty.status === 'open')
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((bounty) => buildRecommendation(bounty, 0));
}

export function generateRecommendations(
  bounties: Bounty[],
  profile: ContributorProfile,
  limit = 3
): BountyRecommendation[] {
  const openBounties = bounties.filter((bounty) => bounty.status === 'open');

  if (profile.completedLabels.length === 0) {
    return getFallbackRecommendations(openBounties, limit);
  }

  return openBounties
    .map((bounty) => ({
      bounty,
      overlap: countLabelOverlap(bounty, profile.completedLabels),
    }))
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => {
      if (b.overlap !== a.overlap) {
        return b.overlap - a.overlap;
      }

      return b.bounty.amount - a.bounty.amount;
    })
    .slice(0, limit)
    .map(({ bounty, overlap }) => buildRecommendation(bounty, overlap));
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

  const newLabels = completedBounties
    .filter((bounty) => bounty.status === 'released')
    .flatMap((bounty) => bounty.labels.map((label) => label.name.toLowerCase()));

  updatedProfile.completedLabels = [...new Set([...profile.completedLabels, ...newLabels])];

  const newRepos = completedBounties
    .filter((bounty) => bounty.status === 'released')
    .map((bounty) => bounty.repo.split('/')[0]);

  updatedProfile.preferredRepos = [...new Set([...profile.preferredRepos, ...newRepos])];

  const releasedBounties = completedBounties.filter((bounty) => bounty.status === 'released');

  if (releasedBounties.length > 0) {
    const amounts = releasedBounties.map((bounty) => bounty.amount);

    updatedProfile.averageRewardRange = {
      min: Math.min(...amounts),
      max: Math.max(...amounts),
    };
  }

  const inferredSkills = new Set<string>(profile.skills);
  const skillKeywords = [
    'react',
    'typescript',
    'javascript',
    'rust',
    'python',
    'solidity',
    'stellar',
    'blockchain',
    'frontend',
    'backend',
    'docs',
    'testing',
    'node.js',
    'node',
    'api',
    'css',
    'html',
    'docker',
    'graphql',
    'web3',
    'smart-contract',
  ];

  for (const label of newLabels) {
    if (skillKeywords.includes(label)) {
      const skill = label.charAt(0).toUpperCase() + label.slice(1);

      if (skill === 'Docs') {
        inferredSkills.add('Docs');
      } else if (skill === 'Node.js') {
        inferredSkills.add('Node.js');
      } else {
        inferredSkills.add(skill);
      }
    }
  }

  updatedProfile.skills = [...inferredSkills];

  return updatedProfile;
}
