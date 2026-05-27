import { z } from "zod";

const GITHUB_PR_URL_REGEX = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+$/;

export function isPrivateNetworkHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  if (
    normalized === "0.0.0.0" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    normalized.startsWith("169.254.")
  ) {
    return true;
  }

  return /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

function isServerFetchSafeUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" && !isPrivateNetworkHostname(parsedUrl.hostname);
  } catch {
    return false;
  }
}

export const githubPrUrlSchema = z
  .string()
  .trim()
  .url()
  // Keep this strict because submissionUrl may later be fetched server-side for PR previews or webhook reconciliation.
  .refine((url) => isServerFetchSafeUrl(url), {
    message: "Submission URL must be an HTTPS URL on a public host",
  })
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
