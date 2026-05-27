import { z } from "zod";

const GITHUB_PR_URL_REGEX = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+$/;

export function extractGitHubPrRepo(submissionUrl: string): string | null {
  try {
    const parsedUrl = new URL(submissionUrl.trim());
    if (parsedUrl.hostname !== "github.com") {
      return null;
    }

    const [owner, repo, segment, number, ...extraSegments] = parsedUrl.pathname.split("/").filter(Boolean);
    if (!owner || !repo || segment !== "pull" || !number || extraSegments.length > 0) {
      return null;
    }

    if (!/^\d+$/.test(number)) {
      return null;
    }

    return `${owner}/${repo}`;
  } catch {
    return null;
  }
}

export function assertGitHubPrMatchesRepo(submissionUrl: string, bountyRepo: string): void {
  const prRepo = extractGitHubPrRepo(submissionUrl);
  if (!prRepo) {
    throw new Error("Submission URL must follow format https://github.com/<owner>/<repo>/pull/<number>");
  }

  // GitHub owner and repository names are case-insensitive for URL matching.
  if (prRepo.toLowerCase() !== bountyRepo.trim().toLowerCase()) {
    throw new Error(`Submission URL must point to a pull request in ${bountyRepo}.`);
  }
}

export const githubPrUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(
    (url) => {
      try {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname === "github.com";
      } catch {
        return false;
      }
    },
    { message: "Submission URL must be from github.com" },
  )
  .refine(
    (url) => {
      try {
        const parsedUrl = new URL(url);
        const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
        return pathParts.length >= 3 && pathParts[2] === "pull";
      } catch {
        return false;
      }
    },
    { message: "Submission URL must contain /pull/ segment" },
  )
  .refine(
    (url) => GITHUB_PR_URL_REGEX.test(url),
    { message: "Submission URL must follow format https://github.com/<owner>/<repo>/pull/<number>" },
  );
