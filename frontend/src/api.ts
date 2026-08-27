import type {
  Bounty,
  BountyEvent,
  CreateBountyPayload,
  GlobalMetrics,
  MaintainerMetrics,
  OpenIssue,
} from './types';
import {
  BountyStatus as ContractBountyStatus,
  ContractError,
  CONTRACT_ERROR_LABELS,
  frontendStatusToContract,
} from './generated';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const READ_RETRY_ATTEMPTS = 3;
const READ_RETRY_BASE_DELAY_MS = 500;

/**
 * Admin API key — the same `x-admin-api-key` mechanism the backend gates
 * admin-only endpoints with (`createAdminApiKeyAuthMiddleware`).  The raw key
 * is held in sessionStorage only, so it never survives a browser session.
 */
const ADMIN_KEY_HEADER = 'x-admin-api-key';
const ADMIN_KEY_STORAGE = 'stellar-bounty-board-admin-key';

/**
 * Persist the admin API key for the current browser session.
 */
export function setAdminApiKey(key: string): void {
  try {
    sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
  } catch {
    // Storage can be unavailable (private mode / disabled cookies) — the key
    // simply won't persist across reloads.
  }
}

/**
 * Retrieve the admin API key stored for the current browser session, if any.
 */
export function getAdminApiKey(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE);
  } catch {
    return null;
  }
}

/**
 * Forget the admin API key (sign-out).
 */
export function clearAdminApiKey(): void {
  try {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    // Ignore storage failures.
  }
}

function adminHeaders(): Record<string, string> {
  const key = getAdminApiKey();
  return key ? { [ADMIN_KEY_HEADER]: key } : {};
}

type ApiBody<T> = T & { error?: string };

type RequestOptions = RequestInit & {
  retry?: boolean;
  retryAttempts?: number;
  retryLabel?: string;
};

type SignedMaintainerActionPayload<Action extends 'release' | 'refund'> = {
  maintainer: string;
  transactionHash?: string;
  action: Action;
  bountyId: string;
  timestamp: number;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as ApiBody<T>;

  if (!response.ok) {
    throw new Error(body.error ?? 'Unexpected API error');
  }

  return body;
}

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const match = header.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);

  if (!match?.[1]) {
    return null;
  }

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
  const suffix = reason ? ` Last error: ${reason}` : '';

  return new Error(
    `${label} failed after ${attempts} attempts due to a temporary backend issue. Please try again in a moment.${suffix}`
  );
}

function ensureRequestId(headers: Record<string, string>) {
  if (!headers['X-Request-ID'] && !headers['x-request-id']) {
    headers['X-Request-ID'] =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    retry = true,
    retryAttempts = READ_RETRY_ATTEMPTS,
    retryLabel = 'Request',
    ...init
  } = options;

  const headers = { ...((init.headers || {}) as Record<string, string>) };
  ensureRequestId(headers);
  init.headers = headers;

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

async function requestBlob(
  path: string,
  options: RequestOptions = {}
): Promise<{ blob: Blob; filename: string | null }> {
  const {
    retry = true,
    retryAttempts = READ_RETRY_ATTEMPTS,
    retryLabel = 'Request',
    ...init
  } = options;

  const headers = { ...((init.headers || {}) as Record<string, string>) };
  ensureRequestId(headers);
  init.headers = headers;

  let lastError: unknown;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${path}`, init);

      if (retry && isRetryableResponse(response) && attempt < retryAttempts) {
        await wait(READ_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }

      if (retry && isRetryableResponse(response) && attempt === retryAttempts) {
        const contentType = response.headers.get('content-type') ?? '';

        if (contentType.includes('application/json')) {
          const body = (await response.json().catch(() => ({}))) as ApiBody<{
            error?: string;
          }>;

          throw formatRetryError(
            retryLabel,
            retryAttempts,
            body.error ?? `HTTP ${response.status}`
          );
        }

        const text = await response.text().catch(() => '');
        throw formatRetryError(retryLabel, retryAttempts, text || `HTTP ${response.status}`);
      }

      if (!response.ok) {
        const contentType = response.headers.get('content-type') ?? '';

        if (contentType.includes('application/json')) {
          const body = (await response.json().catch(() => ({}))) as ApiBody<{
            error?: string;
          }>;

          throw new Error(body.error ?? 'Unexpected API error');
        }

        const text = await response.text().catch(() => '');
        throw new Error(text || `Request failed with HTTP ${response.status}`);
      }

      const filename = parseFilenameFromContentDisposition(
        response.headers.get('content-disposition')
      );
      const blob = await response.blob();

      return { blob, filename };
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

export async function listBounties(signal?: AbortSignal): Promise<Bounty[]> {
  const body = await requestJson<{ data: Bounty[] }>('/bounties', {
    retry: true,
    retryLabel: 'Loading bounties',
    signal,
  });

  return body.data;
}

export async function getBounty(id: string, signal?: AbortSignal): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}`, {
    retry: true,
    signal,
  });

  return body.data;
}

export async function createBounty(payload: CreateBountyPayload): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>('/bounties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return body.data;
}

export async function reserveBounty(
  id: string,
  contributor: string,
  expectedVersion?: number
): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contributor, expectedVersion }),
  });

  return body.data;
}

export async function submitBounty(
  id: string,
  contributor: string,
  submissionUrl: string,
  notes?: string
): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contributor, submissionUrl, notes }),
  });

  return body.data;
}

/**
 * Signed release action - requires a Freighter signature.
 * The caller must sign the exact payload sent in the request body.
 */
export async function releaseBountySigned(
  id: string,
  payload: SignedMaintainerActionPayload<'release'>,
  signature: string,
  publicKey: string
): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/release`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-stellar-signature': signature,
      'x-stellar-public-key': publicKey,
    },
    body: JSON.stringify(payload),
  });

  return body.data;
}

/**
 * Signed refund action - requires a Freighter signature.
 * The caller must sign the exact payload sent in the request body.
 */
export async function refundBountySigned(
  id: string,
  payload: SignedMaintainerActionPayload<'refund'>,
  signature: string,
  publicKey: string
): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-stellar-signature': signature,
      'x-stellar-public-key': publicKey,
    },
    body: JSON.stringify(payload),
  });

  return body.data;
}

/**
 * Legacy release function without Freighter signing.
 * Use releaseBountySigned() for the signed flow.
 */
export async function releaseBounty(
  id: string,
  maintainer: string,
  transactionHash?: string
): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maintainer, transactionHash }),
  });

  return body.data;
}

/**
 * Legacy refund function without Freighter signing.
 * Use refundBountySigned() for the signed flow.
 */
export async function disputeBounty(
  id: string,
  contributor: string,
  reason: string
): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/dispute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contributor, reason }),
  });

  return body.data;
}

export async function resolveDisputeBounty(
  id: string,
  arbiter: string,
  release: boolean,
  transactionHash?: string
): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/resolve-dispute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arbiter, release, transactionHash }),
  });

  return body.data;
}

export async function refundBounty(
  id: string,
  maintainer: string,
  transactionHash?: string
): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maintainer, transactionHash }),
  });

  return body.data;
}

/**
 * Extend a bounty's deadline. `newDeadline` is a Unix timestamp in seconds and
 * must be in the future and later than the current deadline (enforced server-side).
 */
export async function extendDeadline(
  id: string,
  maintainer: string,
  newDeadline: number
): Promise<Bounty> {
  const body = await requestJson<{ data: Bounty }>(`/bounties/${id}/extend-deadline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maintainer, newDeadline }),
  });

  return body.data;
}

export async function listOpenIssues(signal?: AbortSignal): Promise<OpenIssue[]> {
  const body = await requestJson<{ data: OpenIssue[] }>('/open-issues', {
    retry: true,
    retryLabel: 'Loading open issues',
    signal,
  });

  return body.data;
}

export async function exportReleasedPayoutsCsv(): Promise<{
  blob: Blob;
  filename: string;
}> {
  const result = await requestBlob('/bounties/released/export.csv');

  return {
    blob: result.blob,
    filename: result.filename ?? 'released-payouts.csv',
  };
}

export async function getBountyEvents(id: string): Promise<BountyEvent[]> {
  const body = await requestJson<{ data: BountyEvent[] }>(`/bounties/${id}/events`, {
    retry: true,
    retryLabel: 'Loading bounty events',
  });

  return body.data;
}

export async function getMaintainerMetrics(maintainer: string): Promise<MaintainerMetrics> {
  const body = await requestJson<{ data: MaintainerMetrics }>(
    `/maintainers/${maintainer}/metrics`,
    {
      retry: true,
      retryLabel: 'Loading maintainer metrics',
    }
  );

  return body.data;
}

export async function getGlobalMetrics(): Promise<GlobalMetrics> {
  const body = await requestJson<{ data: GlobalMetrics }>('/global-metrics', {
    retry: true,
    retryLabel: 'Loading global metrics',
  });

  return body.data;
}

/**
 * Verify an admin API key against the backend's admin-only audit-log
 * endpoint (401 for an invalid key).  The key is only stored once verified.
 */
export async function verifyAdminKey(key: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = { [ADMIN_KEY_HEADER]: key };
    ensureRequestId(headers);
    const response = await fetch(`${API_BASE}/audit-log?limit=1`, { headers });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * One record from the global admin-only audit log
 * (`GET /api/audit-log`).
 */
export interface AuditLogEntry {
  id: string;
  bountyId: string;
  fromStatus: string;
  toStatus: string;
  transition: string;
  actor: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface AuditLogPage {
  data: AuditLogEntry[];
  pagination: {
    hasMore: boolean;
    nextOffset: number | null;
  };
}

const AUDIT_EXPORT_PAGE_SIZE = 200;
/** Safety cap so a runaway audit store cannot stall the browser forever. */
const AUDIT_EXPORT_MAX_RECORDS = 10_000;

/**
 * Fetch the full admin audit log (all pages) and return it as a downloadable
 * JSON file.  Requires a verified admin key (`setAdminApiKey`).
 */
export async function exportAuditLog(): Promise<{ blob: Blob; filename: string }> {
  const records: AuditLogEntry[] = [];
  let offset = 0;

  // Page through the admin audit-log endpoint until exhausted (or the safety
  // cap is reached).
  while (records.length < AUDIT_EXPORT_MAX_RECORDS) {
    const page = await requestJson<AuditLogPage>(
      `/audit-log?limit=${AUDIT_EXPORT_PAGE_SIZE}&offset=${offset}`,
      {
        headers: adminHeaders(),
        retry: false,
        retryLabel: 'Exporting audit log',
      }
    );

    records.push(...page.data);

    if (!page.pagination?.hasMore || page.data.length === 0) {
      break;
    }

    offset = page.pagination.nextOffset ?? offset + page.data.length;
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const blob = new Blob([JSON.stringify(records, null, 2)], {
    type: 'application/json',
  });

  return { blob, filename: `audit-log-${timestamp}.json` };
}

/**
 * Result of a manual archive run (`POST /api/admin/archive`).
 */
export interface AdminArchiveResult {
  archivedCount: number;
  archivedBountyIds: string[];
  checkedAt: number;
}

/**
 * Trigger an archive pass (same logic as the scheduled archive job).
 * Requires a verified admin key (`setAdminApiKey`).
 */
export async function runAdminArchive(): Promise<AdminArchiveResult> {
  const body = await requestJson<{ data: AdminArchiveResult }>('/admin/archive', {
    method: 'POST',
    headers: adminHeaders(),
    retry: false,
    retryLabel: 'Running archive',
  });

  return body.data;
}

/**
 * Map a backend bounty status string to the on-chain contract enum.
 * Keeps the frontend aligned with the Soroban ABI: if the contract adds or
 * reorders a variant, the generated enum will change and TypeScript will
 * surface the drift here.
 */
export function toContractBountyStatus(status: Bounty['status']): ContractBountyStatus {
  return frontendStatusToContract(status);
}

/**
 * Human-readable label for a contract error code returned by the backend or
 * indexer. Uses the generated ContractError enum so labels stay in sync.
 */
export function getContractErrorLabel(error: ContractError): string {
  return CONTRACT_ERROR_LABELS[error] ?? 'UnknownContractError';
}

/**
 * Stellar test network configuration for Freighter.
 */
export const STELLAR_NETWORK_PASSPHRASE =
  import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';
