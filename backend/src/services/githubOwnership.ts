import { logger } from "../logger";

const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubOwnershipResult {
  verified: boolean;
  githubUsername?: string;
  githubUserId?: number;
  permission?: string;
  error?: string;
}

function getGitHubToken(): string | undefined {
  return process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_APP_TOKEN?.trim();
}

function getTrustedTestRepos(): string[] {
  const raw = process.env.TRUSTED_TEST_REPOS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((repo) => repo.trim().toLowerCase())
    .filter(Boolean);
}

function isTrustedTestRepo(repo: string): boolean {
  const trusted = getTrustedTestRepos();
  return trusted.includes(repo.toLowerCase());
}

export async function verifyGitHubRepoOwnership(
  repo: string,
  githubToken: string,
): Promise<GitHubOwnershipResult> {
  const [owner, repoName] = repo.split("/");

  if (!owner || !repoName) {
    return { verified: false, error: "Invalid repository format. Expected owner/repo." };
  }

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repoName}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "stellar-bounty-board",
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { verified: false, error: "Repository not found." };
      }
      if (response.status === 403) {
        return { verified: false, error: "GitHub API rate limit exceeded or access denied." };
      }
      return { verified: false, error: `GitHub API error: ${response.status}` };
    }

    const repoData = await response.json() as { owner: { login: string; id: number }; permissions?: { admin: boolean; push: boolean; pull: boolean } };

    return {
      verified: true,
      githubUsername: repoData.owner.login,
      githubUserId: repoData.owner.id,
      permission: repoData.permissions?.admin
        ? "admin"
        : repoData.permissions?.push
          ? "write"
          : "read",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ operation: "verifyGitHubRepoOwnership", error: message });
    return { verified: false, error: `Failed to verify repository ownership: ${message}` };
  }
}

export async function checkMaintainerRepoAccess(
  repo: string,
  githubUsername: string,
  githubToken: string,
): Promise<GitHubOwnershipResult> {
  const [owner, repoName] = repo.split("/");

  if (!owner || !repoName) {
    return { verified: false, error: "Invalid repository format. Expected owner/repo." };
  }

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repoName}/collaborators/${githubUsername}/permission`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "stellar-bounty-board",
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { verified: false, error: "User is not a collaborator on this repository." };
      }
      return { verified: false, error: `GitHub API error: ${response.status}` };
    }

    const data = await response.json() as { permission: string };
    const hasWriteAccess = data.permission === "admin" || data.permission === "write";

    return {
      verified: hasWriteAccess,
      permission: data.permission,
      error: hasWriteAccess ? undefined : `Insufficient permissions. Required: write or admin. Found: ${data.permission}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ operation: "checkMaintainerRepoAccess", error: message });
    return { verified: false, error: `Failed to check repository access: ${message}` };
  }
}

export async function verifyMaintainerOwnership(
  repo: string,
  maintainerStellarAddress: string,
): Promise<GitHubOwnershipResult> {
  if (isTrustedTestRepo(repo)) {
    logger.info({ operation: "verifyMaintainerOwnership", repo, bypass: "trusted_test_repo" });
    return {
      verified: true,
      githubUsername: "trusted-test-repo",
      permission: "admin",
    };
  }

  const token = getGitHubToken();
  if (!token) {
    logger.warn({ operation: "verifyMaintainerOwnership", error: "GITHUB_TOKEN not configured" });
    return {
      verified: false,
      error: "GitHub ownership verification is not configured. Set GITHUB_TOKEN environment variable.",
    };
  }

  const repoCheck = await verifyGitHubRepoOwnership(repo, token);
  if (!repoCheck.verified) {
    return repoCheck;
  }

  return {
    verified: true,
    githubUsername: repoCheck.githubUsername,
    githubUserId: repoCheck.githubUserId,
    permission: repoCheck.permission,
  };
}
