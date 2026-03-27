import { Bounty, CreateBountyPayload, OpenIssue } from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const READ_RETRY_ATTEMPTS = 3;
const READ_RETRY_BASE_DELAY_MS = 300;

type ApiBody<T> = T & { error?: string };

type RequestOptions = RequestInit & {
  retry?: boolean;
  retryAttempts?: number;
  retryLabel?: string;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as ApiBody<T>;
  if (!response.ok) {
    throw new Error(body.error ?? "Unexpected API error");
  }
  return body;
}

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/filename\*?=(?:UTF-8''|")?([^\";]+)"?/i);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRetryableResponse(response: Response): boolean {
  return RETRYABLE_STATUSES.has(response.status);
}

function isRetryableError(error: unknown): boolean {
  return error instanceof TypeError;
}

function formatRetryError(label: string, attempts: number, reason?: string): Error {
  const suffix = reason ? ` Last error: ${reason}` : "";
  return new Error(
    `${label} failed after ${attempts} attempts due to a temporary backend issue. Please try again in a moment.${suffix}`,
  );
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { retry = false, retryAttempts = READ_RETRY_ATTEMPTS, retryLabel = "Request", ...init } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${path}`, init);

      if (retry && isRetryableResponse(response) && attempt < retryAttempts) {
        await wait(READ_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }

      if (retry && isRetryableResponse(response) && attempt === retryAttempts) {
        const body = (await response.json().catch(() => ({}))) as ApiBody<T>;
        throw formatRetryError(retryLabel, retryAttempts, body.error ?? `HTTP ${response.status}`);
      }

      return parseResponse<T>(response);
    } catch (error) {
      lastError = error;

      if (!retry || !isRetryableError(error)) {
        throw error;
      }

      if (attempt === retryAttempts) {
        const message = error instanceof Error ? error.message : undefined;
        throw formatRetryError(retryLabel, retryAttempts, message);
      }

      await wait(READ_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  const message = lastError instanceof Error ? lastError.message : undefined;
  throw formatRetryError(retryLabel, retryAttempts, message);
}

async function requestBlob(path: string, init: RequestInit = {}): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await response.json().catch(() => ({}))) as ApiBody<{ error?: string }>;
      throw new Error(body.error ?? "Unexpected API error");
    }
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed with HTTP ${response.status}`);
  }

  const filename = parseFilenameFromContentDisposition(response.headers.get("content-disposition"));
  const blob = await response.blob();
  return { blob, filename };
}

export async function listBounties(): Promise<Bounty[]> {
  const body = await requestJson<{ data: Bounty[] }>("/bounties", {
    retry: true,
    retryLabel: "Loading bounties",
  });
  return body.data;
}

export async function createBounty(payload: CreateBountyPayload): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>("/bounties", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return body.data;
}

export async function reserveBounty(id: string, contributor: string): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/reserve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contributor }),
  });
  return body.data;
}

export async function submitBounty(
  id: string,
  contributor: string,
  submissionUrl: string,
  notes?: string,
): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contributor, submissionUrl, notes }),
  });
  return body.data;
}

export async function releaseBounty(id: string, maintainer: string): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maintainer }),
  });
  return body.data;
}

export async function refundBounty(id: string, maintainer: string): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maintainer }),
  });
  return body.data;
}

export async function listOpenIssues(): Promise<OpenIssue[]> {
  const body = await requestJson<{ data: OpenIssue[] }>("/open-issues", {
    retry: true,
    retryLabel: "Loading open issues",
  });
  return body.data;
}

export async function exportReleasedPayoutsCsv(): Promise<{ blob: Blob; filename: string }> {
  const result = await requestBlob("/bounties/released/export.csv");
  return {
    blob: result.blob,
    filename: result.filename ?? "released-payouts.csv",
  };
}

