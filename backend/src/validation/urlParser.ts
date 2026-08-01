import { z } from "zod";

export type Provider = "github" | "gitlab" | "bitbucket";

export interface ParsedIssueUrl {
  provider: Provider;
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface ParsedPrUrl {
  provider: Provider;
  owner: string;
  repo: string;
  prNumber: number;
}

const SUPPORTED_HOSTNAMES: Record<string, Provider> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "bitbucket.org": "bitbucket",
};

function getProvider(hostname: string): Provider | null {
  return SUPPORTED_HOSTNAMES[hostname] ?? null;
}

export function parseIssueUrl(url: string): ParsedIssueUrl | null {
  try {
    const parsed = new URL(url);
    const provider = getProvider(parsed.hostname);
    if (!provider) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);

    switch (provider) {
      case "github": {
        if (parts.length >= 4 && parts[2] === "issues") {
          const issueNumber = parseInt(parts[3], 10);
          if (!isNaN(issueNumber)) {
            return { provider, owner: parts[0], repo: parts[1], issueNumber };
          }
        }
        return null;
      }
      case "gitlab": {
        const dashIdx = parts.indexOf("-");
        if (dashIdx !== -1 && parts[dashIdx + 1] === "issues") {
          const issueNumber = parseInt(parts[dashIdx + 2], 10);
          if (!isNaN(issueNumber) && parts[dashIdx - 2] && parts[dashIdx - 1]) {
            return { provider, owner: parts[dashIdx - 2], repo: parts[dashIdx - 1], issueNumber };
          }
        }
        if (parts.length >= 4 && parts[2] === "issues") {
          const issueNumber = parseInt(parts[3], 10);
          if (!isNaN(issueNumber)) {
            return { provider, owner: parts[0], repo: parts[1], issueNumber };
          }
        }
        return null;
      }
      case "bitbucket": {
        if (parts.length >= 4 && parts[2] === "issues") {
          const issueNumber = parseInt(parts[3], 10);
          if (!isNaN(issueNumber)) {
            return { provider, owner: parts[0], repo: parts[1], issueNumber };
          }
        }
        return null;
      }
    }
  } catch {
    return null;
  }
}

export function parsePrUrl(url: string): ParsedPrUrl | null {
  try {
    const parsed = new URL(url);
    const provider = getProvider(parsed.hostname);
    if (!provider) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);

    switch (provider) {
      case "github": {
        if (parts.length >= 4 && parts[2] === "pull") {
          const prNumber = parseInt(parts[3], 10);
          if (!isNaN(prNumber)) {
            return { provider, owner: parts[0], repo: parts[1], prNumber };
          }
        }
        return null;
      }
      case "gitlab": {
        const dashIdx = parts.indexOf("-");
        if (dashIdx !== -1 && parts[dashIdx + 1] === "merge_requests") {
          const prNumber = parseInt(parts[dashIdx + 2], 10);
          if (!isNaN(prNumber) && parts[dashIdx - 2] && parts[dashIdx - 1]) {
            return { provider, owner: parts[dashIdx - 2], repo: parts[dashIdx - 1], prNumber };
          }
        }
        return null;
      }
      case "bitbucket": {
        if (parts.length >= 4 && parts[2] === "pull-requests") {
          const prNumber = parseInt(parts[3], 10);
          if (!isNaN(prNumber)) {
            return { provider, owner: parts[0], repo: parts[1], prNumber };
          }
        }
        return null;
      }
    }
  } catch {
    return null;
  }
}

export function extractRepoFromPrUrl(url: string): string | undefined {
  const parsed = parsePrUrl(url);
  if (!parsed) return undefined;
  return `${parsed.owner}/${parsed.repo}`;
}

export function validateSubmissionUrlForRepo(submissionUrl: string, bountyRepo: string): void {
  const repo = extractRepoFromPrUrl(submissionUrl);
  if (!repo) {
    throw new Error(
      "Submission URL must be a valid GitHub pull request, GitLab merge request, or Bitbucket pull request URL."
    );
  }
  if (repo !== bountyRepo) {
    throw new Error(`Submission URL repository must match bounty repo ${bountyRepo}.`);
  }
}

export const submissionUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return getProvider(parsed.hostname) !== null;
      } catch {
        return false;
      }
    },
    { message: "Submission URL must be from github.com, gitlab.com, or bitbucket.org" }
  )
  .refine(
    (url) => parsePrUrl(url) !== null,
    {
      message:
        "Submission URL must follow the format of a GitHub pull request, GitLab merge request, or Bitbucket pull request",
    }
  );

export const issueUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return getProvider(parsed.hostname) !== null;
      } catch {
        return false;
      }
    },
    { message: "Issue URL must be from github.com, gitlab.com, or bitbucket.org" }
  )
  .refine(
    (url) => parseIssueUrl(url) !== null,
    {
      message:
        "Issue URL must follow the format of a GitHub, GitLab, or Bitbucket issue URL",
    }
  );
