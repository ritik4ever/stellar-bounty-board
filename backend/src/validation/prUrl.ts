import { z } from "zod";

const GITHUB_PR_URL_REGEX = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+$/;

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

export function extractGithubPrRepo(submissionUrl: string): string | undefined {
  const parsedUrl = new URL(submissionUrl);
  const [owner, repo, segment] = parsedUrl.pathname.split("/").filter(Boolean);
  if (parsedUrl.hostname !== "github.com" || !owner || !repo || segment !== "pull") {
    return undefined;
  }
  return `${owner}/${repo}`;
}

export function validateGithubPrUrlForRepo(submissionUrl: string, bountyRepo: string): void {
  githubPrUrlSchema.parse(submissionUrl);

  // PR submissions must target the same GitHub owner/repo as the bounty so contributors cannot
  // satisfy a bounty with an unrelated pull request URL.
  const prRepo = extractGithubPrRepo(submissionUrl);
  if (prRepo !== bountyRepo) {
    throw new Error(`Submission URL repository must match bounty repo ${bountyRepo}.`);
  }
}
