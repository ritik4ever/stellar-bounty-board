import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import {
  sendNotification,
  type NotificationRecipient,
} from "./notificationService";
import { logStructured } from "../logger";
import { getCache, type CacheAdapter } from "./cache";
 feat/concurrency-file-locking
import { bountiesCreatedTotal, bountiesReleasedTotal } from "../metrics";
import { validateGithubPrUrlForRepo } from "../validation/prUrl";


/**
 * Represents the current state of a bounty.
 *
 * - "open": The bounty is available for reservation.
 * - "reserved": A contributor has reserved the bounty to work on it.
 * - "submitted": The contributor has submitted a solution for review.
 * - "released": The maintainer has approved the submission and released funds.
 * - "refunded": The maintainer has cancelled the bounty and refunded the funds.
 * - "expired": The bounty deadline has passed without completion.
 *
 * @typedef {"open" | "reserved" | "submitted" | "released" | "refunded" | "expired"} BountyStatus
 */
export type BountyStatus =
  | "open"
  | "reserved"
  | "submitted"
  | "released"
  | "refunded"
  | "expired"
  | "disputed";


/**
 * Supported value types for audit log metadata records.
 *
 * @typedef {string | number | boolean | null} AuditMetadataValue
 */
export type AuditMetadataValue = string | number | boolean | null;

/**
 * Types of state transitions that can be recorded in the audit log.
 */
export type BountyTransitionType =
  | "create"
  | "reserve"
  | "submit"
  | "release"
  | "refund"
  | "cancel"
  | "expire"
  | "dispute"
  | "update_notes"
  | "extend_deadline";

/**
 * Represents a historical event in the lifecycle of a bounty.
 */
export interface BountyEvent {
  /** The type of event (usually matches the resulting status or "created"). */
  type: BountyStatus | "created" | "notes_updated" | "deadline_extended";
  /** Unix timestamp in seconds when the event occurred. */
  timestamp: number;
  /** Stellar public key of the actor who triggered the event. */
  actor?: string;
  /** Additional structured event-specific details. */
  details?: Record<string, unknown>;
}

/**
 * A record documenting a transition in bounty status for auditing.
 */
export interface BountyAuditLogRecord {
  /** Unique audit record identifier. */
  id: string;
  /** ID of the audited bounty. */
  bountyId: string;
  /** The status before the transition. */
  fromStatus: BountyStatus;
  /** The status after the transition. */
  toStatus: BountyStatus;
  /** The type of transition that was executed. */
  transition: BountyTransitionType;
  /** Stellar address or system actor who triggered the transition. */
  actor: string;
  /** Unix timestamp in seconds when the transition occurred. */
  timestamp: number;
  /** Additional structured metadata for the transition context. */
  metadata?: Record<string, AuditMetadataValue>;
}

/**
 * Represents a complete bounty record stored in the database.
 */
export interface BountyRecord {
  /** Unique bounty identifier (e.g. BNT-0001). */
  id: string;
  /** GitHub repository path (e.g., owner/repo). */
  repo: string;
  /** Associated GitHub issue number. */
  issueNumber: number;
  /** Title of the GitHub issue. */
  title: string;
  /** Description/summary of the bounty. */
  summary: string;
  /** Stellar address of the maintainer who created the bounty. */
  maintainer: string;
  /** Stellar address of the contributor who reserved/submitted the bounty. */
  contributor?: string;
  /** Payment token symbol (e.g., XLM, USDC). */
  tokenSymbol: string;
  /** Resolved payment token contract address. */
  tokenAddress: string;
  /** The reward amount. */
  amount: number;
  /** Array of labels categorized on the bounty. */
  labels: string[];
  /** Current status of the bounty. */
  status: BountyStatus;
  /** Unix timestamp in seconds of bounty creation. */
  createdAt: number;
  /** Unix timestamp in seconds of the bounty deadline. */
  deadlineAt: number;
  /** Unix timestamp in seconds of when the bounty was reserved. */
  reservedAt?: number;
  /** Unix timestamp in seconds of when the submission was made. */
  submittedAt?: number;
  /** Unix timestamp in seconds of when the bounty was released. */
  releasedAt?: number;
  /** Stellar transaction hash of the release payment. */
  releasedTxHash?: string;
  /** Protocol fee collected when this bounty was released (in token units). */
  protocolFeeCollected?: number;
  /** Unix timestamp in seconds of when the bounty was refunded. */
  refundedAt?: number;
  /** Stellar transaction hash of the refund payment. */
  refundedTxHash?: string;
  /** Unix timestamp in seconds of when an open bounty was canceled by the maintainer. */
  canceledAt?: number;
  /** Stellar transaction hash of the cancellation payment. */
  canceledTxHash?: string;
  /** URL to the submission solution (e.g., Pull Request link). */
  submissionUrl?: string;
  /** Submission notes left by the contributor. */
  notes?: string;
  /** Unix timestamp in seconds of when the bounty was disputed. */
  disputedAt?: number;
  /** Reason provided by the contributor for disputing the bounty. */
  disputeReason?: string;
  // Race condition prevention
  /** Version number of the record used for optimistic locking. */
  version: number;
  // Event history
  /** Event log tracking history of lifecycle transitions. */
  events: BountyEvent[];
  // Reservation timeout (in seconds from reservation)
  /** Number of seconds after reservation before it automatically times out. */
  reservationTimeoutSeconds?: number;
}

/**
 * Input arguments required to create a new bounty.
 */
export interface CreateBountyInput {
  /** GitHub repository path (e.g., owner/repo). */
  repo: string;
  /** Associated GitHub issue number. */
  issueNumber: number;
  /** Title of the GitHub issue. */
  title: string;
  /** Description/summary of the bounty. */
  summary: string;
  /** Stellar address of the maintainer funding the bounty. */
  maintainer: string;
  /** Payment token symbol (e.g., XLM, USDC). */
  tokenSymbol: string;
  /** The reward amount. */
  amount: number;
  /** Number of days before the bounty deadline is reached. */
  deadlineDays: number;
  /** Array of tags or labels to assign to the bounty. */
  labels: string[];
  /** Optional custom timeout in seconds for reservation expiration. */
  reservationTimeoutSeconds?: number;
}

interface CreateAuditLogInput {
  bountyId: string;
  fromStatus: BountyStatus;
  toStatus: BountyStatus;
  transition: BountyTransitionType;
  actor: string;
  timestamp?: number;
  metadata?: Record<string, AuditMetadataValue | undefined>;
}

function getStorePath(): string {
  if (process.env.BOUNTY_STORE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_STORE_PATH.trim());
  }
  return path.resolve(__dirname, "../../data/bounties.json");
}

function getAuditStorePath(): string {
  if (process.env.BOUNTY_AUDIT_STORE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_AUDIT_STORE_PATH.trim());
  }

  const base = getStorePath();
  return base.endsWith(".json")
    ? base.replace(/\.json$/i, ".audit.json")
    : `${base}.audit.json`;
}

/**
 * Get the lock timeout in milliseconds from environment variable.
 * Defaults to 5000ms (5 seconds) if not set or invalid.
 */
function getLockTimeoutMs(): number {
  const envValue = process.env.STORE_LOCK_TIMEOUT_MS;
  if (!envValue) {
    return 5000;
  }
  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed <= 0) {
    return 5000;
  }
  return parsed;
}

const sampleBounties: BountyRecord[] = [
  {
    id: "BNT-0001",
    repo: "ritik4ever/stellar-stream",
    issueNumber: 41,
    title: "Add WebSocket updates for stream lifecycle changes",
    summary:
      "Push stream creation, cancel, and completion events to the dashboard without polling so recipients see updates instantly.",
    maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    contributor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    tokenSymbol: "XLM",
    tokenAddress: "CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA",
    amount: 150,
    labels: ["help wanted", "realtime"],
    status: "reserved",
    createdAt: 1710000000,
    deadlineAt: 1910000000,
    reservedAt: 1710003600,
    version: 1,
    events: [
      { type: "created", timestamp: 1710000000 },
      {
        type: "reserved",
        timestamp: 1710003600,
        actor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      },
    ],
    reservationTimeoutSeconds: 604800,
  },
  {
    id: "BNT-0002",
    repo: "ritik4ever/stellar-stream",
    issueNumber: 42,
    title: "Build a recipient earnings export screen",
    summary:
      "Create a contributor-facing export view for released payouts with CSV download and per-asset grouping.",
    maintainer: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    tokenSymbol: "USDC",
    tokenAddress: "CCW677VKUVRVH25WJ3G7L2NKV6AEFBSFW4FG7L0XXXXXX",
    amount: 220,
    labels: ["frontend", "analytics"],
    status: "open",
    createdAt: 1710500000,
    deadlineAt: 1910500000,
    version: 1,
    events: [{ type: "created", timestamp: 1710500000 }],
    reservationTimeoutSeconds: 604800,
  },
];

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function ensureStore(): void {
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  ensureAuditStore();

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify(sampleBounties, null, 2));
    return;
  }

  const raw = fs.readFileSync(storePath, "utf8").trim();
  if (!raw) {
    fs.writeFileSync(storePath, JSON.stringify(sampleBounties, null, 2));
  }
}

function ensureAuditStore(): void {
  const storePath = getAuditStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify([], null, 2));
    return;
  }

  const raw = fs.readFileSync(storePath, "utf8").trim();
  if (!raw) {
    fs.writeFileSync(storePath, JSON.stringify([], null, 2));
  }
}

function readStore(): BountyRecord[] {
  ensureStore();
  const storePath = getStorePath();
  return JSON.parse(fs.readFileSync(storePath, "utf8")) as BountyRecord[];
}

function writeStore(records: BountyRecord[]): void {
  fs.writeFileSync(getStorePath(), JSON.stringify(records, null, 2));
}

function readAuditStore(): BountyAuditLogRecord[] {
  ensureAuditStore();
  return JSON.parse(
    fs.readFileSync(getAuditStorePath(), "utf8"),
  ) as BountyAuditLogRecord[];
}

function writeAuditStore(records: BountyAuditLogRecord[]): void {
  fs.writeFileSync(getAuditStorePath(), JSON.stringify(records, null, 2));
}

function nextAuditId(records: BountyAuditLogRecord[]): string {
  const highest = records.reduce((max, record) => {
    const numeric = Number(record.id.replace("AUD-", ""));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
  return `AUD-${String(highest + 1).padStart(6, "0")}`;
}

function cleanAuditMetadata(
  metadata?: Record<string, AuditMetadataValue | undefined>,
): Record<string, AuditMetadataValue> | undefined {
  if (!metadata) {
    return undefined;
  }

  const entries = Object.entries(metadata).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as Record<string, AuditMetadataValue>;
}

function appendAuditLogs(inputs: CreateAuditLogInput[]): void {
  if (inputs.length === 0) {
    return;
  }

  const existing = readAuditStore();
  const next = [...existing];

  for (const input of inputs) {
    next.push({
      id: nextAuditId(next),
      bountyId: input.bountyId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      transition: input.transition,
      actor: input.actor,
      timestamp: input.timestamp ?? nowInSeconds(),
      metadata: cleanAuditMetadata(input.metadata),
    });
  }

  writeAuditStore(next);
}

function normalizeRecords(records: BountyRecord[]): BountyRecord[] {
  const now = nowInSeconds();
  let changed = false;
  const auditEntries: CreateAuditLogInput[] = [];

  const next = records.map((record) => {
    // Ensure events array exists (for backward compatibility)
    const events: BountyEvent[] = record.events || [
      { type: "created" as const, timestamp: record.createdAt },
    ];

    // Check for expired deadline
    if (
      (record.status === "open" || record.status === "reserved") &&
      now > record.deadlineAt
    ) {
      changed = true;
      auditEntries.push({
        bountyId: record.id,
        fromStatus: record.status,
        toStatus: "expired",
        transition: "expire",
        actor: "system",
        timestamp: now,
        metadata: {
          reason: "deadline_passed",
          deadlineAt: record.deadlineAt,
        },
      });
      return {
        ...record,
        status: "expired" as const,
        events: [...events, { type: "expired" as const, timestamp: now }],
      };
    }

    // Check for expired reservation (timeout without submission)
    if (
      record.status === "reserved" &&
      record.reservedAt &&
      record.reservationTimeoutSeconds &&
      now > record.reservedAt + record.reservationTimeoutSeconds
    ) {
      changed = true;
      return {
        ...record,
        status: "open" as const,
        contributor: undefined,
        reservedAt: undefined,
        events: [
          ...events,
          {
            type: "expired" as const,
            timestamp: now,
            details: { reason: "reservation_timeout" },
          },
        ],
      };
    }

    // Ensure version and events exist for backward compatibility
    if (!record.version || !record.events) {
      changed = true;
      return {
        ...record,
        version: record.version || 1,
        events,
        reservationTimeoutSeconds: record.reservationTimeoutSeconds || 604800,
      };
    }

    return record;
  });

  if (changed) {
    writeStore(next);
    appendAuditLogs(auditEntries);
  }
  return next;
}

function nextId(records: BountyRecord[]): string {
  const max = records.reduce((highest, record) => {
    const numeric = Number(record.id.replace("BNT-", ""));
    return Number.isFinite(numeric) ? Math.max(highest, numeric) : highest;
  }, 0);
  return `BNT-${String(max + 1).padStart(4, "0")}`;
}

function findBounty(records: BountyRecord[], id: string): BountyRecord {
  const bounty = records.find((record) => record.id === id);
  if (!bounty) {
    throw new Error("Bounty not found.");
  }
  return bounty;
}

function persistUpdated(
  records: BountyRecord[],
  updated: BountyRecord,
): BountyRecord {
  const next = records.map((record) =>
    record.id === updated.id ? updated : record,
  );
  writeStore(next);
  return updated;
}

export interface ListBountiesOptions {
  /** Case-insensitive substring filter applied to title, summary, and labels. */
  q?: string;
  /** Exact Stellar address filter applied to contributor. */
  contributor?: string;
  /** Exact Stellar address filter applied to maintainer. */
  maintainer?: string;
  /** Exact token symbol filter. */
  tokenSymbol?: string;
  /** Exact bounty status filter. */
  status?: BountyStatus;
  /** Sort field for the result set. */
  sort?: "amount" | "deadline" | "createdAt" | "status";
  /** Sort direction for the result set. */
  order?: "asc" | "desc";
  /** Filter bounties with deadlineBefore (unix timestamp in seconds). */
  deadlineBefore?: number;
  /** Filter bounties with deadlineAfter (unix timestamp in seconds). */
  deadlineAfter?: number;
}

export function listBounties(options: ListBountiesOptions = {}): BountyRecord[] {
  const records = normalizeRecords(readStore());
  const q = options.q?.trim().toLowerCase();
  const contributor = options.contributor?.trim();
  const maintainer = options.maintainer?.trim();
  const tokenSymbol = options.tokenSymbol?.trim().toUpperCase();
  const status = options.status;
  const deadlineBefore = options.deadlineBefore;
  const deadlineAfter = options.deadlineAfter;

  // Single-pass: filter and copy in one iteration, then sort.
  const result: BountyRecord[] = [];
  for (let i = 0; i < records.length; i++) {
    const b = records[i];
    const passesQ =
      !q ||
      b.title.toLowerCase().includes(q) ||
      b.summary.toLowerCase().includes(q) ||
      b.labels.some((l) => l.toLowerCase().includes(q));
    const passesContributor = !contributor || b.contributor === contributor;
    const passesMaintainer = !maintainer || b.maintainer === maintainer;
    const passesTokenSymbol = !tokenSymbol || b.tokenSymbol.toUpperCase() === tokenSymbol;
    const passesStatus = !status || b.status === status;
    const passesDeadlineBefore = deadlineBefore === undefined || b.deadlineAt < deadlineBefore;
    const passesDeadlineAfter = deadlineAfter === undefined || b.deadlineAt > deadlineAfter;
    if (passesQ && passesContributor && passesMaintainer && passesTokenSymbol && passesStatus && passesDeadlineBefore && passesDeadlineAfter) {
      result.push(b);
    }
  }

  sortBounties(result, options.sort ?? "createdAt", options.order ?? "desc");
  return result;
}


function sortBounties(
  bounties: BountyRecord[],
  sort: "amount" | "deadline" | "createdAt" | "status",
  order: "asc" | "desc",
): void {
  const direction = order === "asc" ? 1 : -1;
  bounties.sort((a, b) => {
    let comparison: number;
    if (sort === "deadline") {
      comparison = a.deadlineAt - b.deadlineAt;
    } else if (sort === "status") {
      comparison = a.status.localeCompare(b.status);
    } else {
      comparison = a[sort] - b[sort];
    }
    return comparison * direction || b.createdAt - a.createdAt;
  });
}

// ── Cached list for the public board (#361) ──────────────────────────────────

const BOUNTY_LIST_CACHE_KEY = "bounties:list";
const BOUNTY_LIST_TTL_SECONDS = 5;

/**
 * Cache-backed variant of {@link listBounties} for the hot `/api/bounties` read
 * path. The full normalized+sorted list is cached (5s TTL) so it is shared
 * across replicas via Redis; filters are applied to the cached list
 * per request. Writes call {@link invalidateBountyCache}.
 *
 * @param {ListBountiesOptions} [options={}] - Filtering options for the bounty retrieval.
 * @param {CacheAdapter} [cache=getCache()] - The cache adapter to use for caching.
 * @returns {Promise<BountyRecord[]>} A promise that resolves to the sorted and filtered list of bounty records.
 */
export async function listBountiesCached(
  options: ListBountiesOptions = {},
  cache: CacheAdapter = getCache(),
): Promise<BountyRecord[]> {
  let records: BountyRecord[];
  const cached = await cache.get(BOUNTY_LIST_CACHE_KEY);
  if (cached) {
    records = JSON.parse(cached) as BountyRecord[];
  } else {
    records = listBounties();
    await cache.set(BOUNTY_LIST_CACHE_KEY, JSON.stringify(records), BOUNTY_LIST_TTL_SECONDS);
  }

  const q = options.q?.trim().toLowerCase();
  const contributor = options.contributor?.trim();
  const maintainer = options.maintainer?.trim();
  const tokenSymbol = options.tokenSymbol?.trim().toUpperCase();
  const status = options.status;
  const deadlineBefore = options.deadlineBefore;
  const deadlineAfter = options.deadlineAfter;

  const filtered = records.filter((b) => {
    const passesQ =
      !q ||
      b.title.toLowerCase().includes(q) ||
      b.summary.toLowerCase().includes(q) ||
      b.labels.some((l) => l.toLowerCase().includes(q));
    const passesContributor = !contributor || b.contributor === contributor;
    const passesMaintainer = !maintainer || b.maintainer === maintainer;
    const passesTokenSymbol = !tokenSymbol || b.tokenSymbol.toUpperCase() === tokenSymbol;
    const passesStatus = !status || b.status === status;
    const passesDeadlineBefore = deadlineBefore === undefined || b.deadlineAt < deadlineBefore;
    const passesDeadlineAfter = deadlineAfter === undefined || b.deadlineAt > deadlineAfter;
    return passesQ && passesContributor && passesMaintainer && passesTokenSymbol && passesStatus && passesDeadlineBefore && passesDeadlineAfter;
  });

  sortBounties(filtered, options.sort ?? "createdAt", options.order ?? "desc");
  return filtered;
}

/**
 * Drop the cached bounty list so the next read reflects a mutation (#361).
 *
 * @param {CacheAdapter} [cache=getCache()] - The cache adapter to invalidate the cache from.
 * @returns {Promise<void>} A promise that resolves when the cache has been invalidated.
 */
export async function invalidateBountyCache(cache: CacheAdapter = getCache()): Promise<void> {
  await cache.del(BOUNTY_LIST_CACHE_KEY);
}

/**
 * Acquires a file lock on the store path, executes the provided function,
 * and releases the lock when done (or on error).
 *
 * Uses configurable retry logic so that concurrent requests can queue up
 * and be serialized. The lock timeout is configurable via STORE_LOCK_TIMEOUT_MS.
 */
async function withStoreLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const storePath = getStorePath();
  const timeout = getLockTimeoutMs();
  const release = await lockfile.lock(storePath, {
    stale: 10000,
    update: 5000,
    retries: 0, // Fail fast - concurrent requests get immediate error
  });

  try {
    return await fn();
  } finally {
    await release();
  }
}

export async function createBounty(
  input: CreateBountyInput,
): Promise<BountyRecord> {
  return withStoreLock(async () => {
    const records = listBounties();
    const createdAt = nowInSeconds();
    const bounty: BountyRecord = {
      id: nextId(records),
      repo: input.repo,
      issueNumber: input.issueNumber,
      title: input.title,
      summary: input.summary,
      maintainer: input.maintainer,
      tokenSymbol: input.tokenSymbol.toUpperCase(),
      tokenAddress: resolveTokenAddress(input.tokenSymbol),
      amount: Number(input.amount.toFixed(2)),
      labels: input.labels,
      status: "open",
      createdAt,
      deadlineAt: createdAt + input.deadlineDays * 24 * 60 * 60,
      version: 1,
      events: [{ type: "created", timestamp: createdAt }],
      reservationTimeoutSeconds: input.reservationTimeoutSeconds ?? 604800,
    };

    writeStore([bounty, ...records]);
    await invalidateBountyCache();

    // Trigger notification on create
    const recipients: NotificationRecipient[] = [
      { role: "maintainer", address: input.maintainer },
    ];

    // Non-blocking: notifications fire-and-forget
    sendNotification(recipients, "bounty_created", {
      bountyId: bounty.id,
      repo: bounty.repo,
      issueNumber: bounty.issueNumber,
      title: bounty.title,
      status: bounty.status,
      maintainer: input.maintainer,
      amount: bounty.amount,
      tokenSymbol: bounty.tokenSymbol,
    }).catch((err) =>
      logStructured("warn", "notification_failed", {
        operation: "createBounty",
        bountyId: bounty.id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );

    return bounty;
  });
}

export async function reserveBounty(
  id: string,
  contributor: string,
  expectedVersion?: number,
): Promise<BountyRecord> {
  return withStoreLock(async () => {
    const records = listBounties();
    const bounty = findBounty(records, id);

    if (bounty.status !== "open") {
      throw new Error("Only open bounties can be reserved.");
    }

    // Race condition prevention: check version if provided
    if (expectedVersion !== undefined && bounty.version !== expectedVersion) {
      throw new Error(
        "Bounty was just reserved by someone else. Please refresh and try again.",
      );
    }

    const now = nowInSeconds();
    const updated: BountyRecord = {
      ...bounty,
      contributor,
      status: "reserved",
      reservedAt: now,
      version: bounty.version + 1,
      events: [
        ...bounty.events,
        { type: "reserved", timestamp: now, actor: contributor },
      ],
    };

    const persisted = persistUpdated(records, updated);
    appendAuditLogs([
      {
        bountyId: id,
        fromStatus: bounty.status,
        toStatus: "reserved",
        transition: "reserve",
        actor: contributor,
      },
    ]);
    await invalidateBountyCache();

    sendNotification(
      [{ role: "maintainer", address: bounty.maintainer }],
      "bounty_reserved",
      {
        bountyId: id,
        title: bounty.title,
        amount: bounty.amount,
        tokenSymbol: bounty.tokenSymbol,
        contributor,
      },
    ).catch((err) =>
      console.warn("[reserveBounty] Notification failed (non-blocking):", err),
    );

    return persisted;
  });
}

/**
 * Submits a solution for a reserved bounty.
 *
 * Acquires a file lock during execution. The bounty status transitions from "reserved" to "submitted".
 *
 * @param {string} id - The unique ID of the bounty.
 * @param {string} contributor - The Stellar address of the contributor making the submission.
 * @param {string} submissionUrl - The URL pointing to the pull request or solution.
 * @param {string} [notes] - Optional additional notes or details about the submission.
 * @returns {Promise<BountyRecord>} A promise that resolves to the updated bounty record.
 * @throws {Error} If the bounty is not found.
 * @throws {Error} If the bounty is not currently in the "reserved" status.
 * @throws {Error} If the contributor address does not match the contributor who reserved the bounty.
 */
export async function submitBounty(
  id: string,
  contributor: string,
  submissionUrl: string,
  notes?: string,
): Promise<BountyRecord> {
  return withStoreLock(async () => {
    const records = listBounties();
    const bounty = findBounty(records, id);

    if (bounty.status !== "reserved") {
      throw new Error("Only reserved bounties can be submitted.");
    }
    if (bounty.contributor !== contributor) {
      throw new Error("Only the reserved contributor can submit this bounty.");
    }

    validateGithubPrUrlForRepo(submissionUrl, bounty.repo);

    const now = nowInSeconds();
    const updated: BountyRecord = {
      ...bounty,
      status: "submitted",
      submittedAt: now,
      submissionUrl,
      notes,
      version: bounty.version + 1,
      events: [
        ...bounty.events,
        { type: "submitted", timestamp: now, actor: contributor },
      ],
    };

    const persisted = persistUpdated(records, updated);
    appendAuditLogs([
      {
        bountyId: id,
        fromStatus: bounty.status,
        toStatus: "submitted",
        transition: "submit",
        actor: contributor,
        metadata: {
          submissionUrl,
          hasNotes: Boolean(notes?.trim()),
        },
      },
    ]);
    await invalidateBountyCache();

    sendNotification(
      [{ role: "maintainer", address: bounty.maintainer }],
      "bounty_submitted",
      {
        bountyId: id,
        title: bounty.title,
        amount: bounty.amount,
        tokenSymbol: bounty.tokenSymbol,
        contributor,
        submissionUrl,
      },
    ).catch((err) =>
      console.warn("[submitBounty] Notification failed (non-blocking):", err),
    );

    return persisted;
  });
}

/**
 * Releases the funds for a submitted bounty, marking it as finalized.
 *
 * Acquires a file lock during execution. Transitions the bounty status to "released".
 *
 * @param {string} id - The unique ID of the bounty.
 * @param {string} maintainer - The Stellar address of the maintainer releasing the bounty.
 * @param {string} [transactionHash] - Optional Stellar transaction hash for the payment.
 * @param {number} [protocolFeeCollected=0] - Protocol fee amount collected for this release.
 * @returns {Promise<BountyRecord>} A promise that resolves to the updated bounty record.
 * @throws {Error} If the bounty is not found.
 * @throws {Error} If the maintainer address does not match the maintainer who created the bounty.
 * @throws {Error} If the bounty status is not "submitted".
 */
export async function releaseBounty(
  id: string,
  maintainer: string,
  transactionHash?: string,
  protocolFeeCollected = 0,
): Promise<BountyRecord> {
  return withStoreLock(async () => {
    const records = listBounties();
    const bounty = findBounty(records, id);

    if (bounty.maintainer !== maintainer) {
      throw new Error("Maintainer address does not match this bounty.");
    }
    if (bounty.status !== "submitted") {
      throw new Error("Only submitted bounties can be released.");
    }

    const now = nowInSeconds();
    const updated: BountyRecord = {
      ...bounty,
      status: "released",
      releasedAt: now,
      releasedTxHash: transactionHash?.trim()
        ? transactionHash.trim()
        : bounty.releasedTxHash,
      protocolFeeCollected: protocolFeeCollected > 0 ? protocolFeeCollected : (bounty.protocolFeeCollected ?? 0),
      version: bounty.version + 1,
      events: [
        ...bounty.events,
        { type: "released", timestamp: now, actor: maintainer },
      ],
    };

    const persisted = persistUpdated(records, updated);
    appendAuditLogs([
      {
        bountyId: id,
        fromStatus: bounty.status,
        toStatus: "released",
        transition: "release",
        actor: maintainer,
        metadata: {
          transactionHash: updated.releasedTxHash,
        },
      },
    ]);
    await invalidateBountyCache();


    return persisted;
  });
}

/**
 * Refunds the bounty funds back to the maintainer.
 *
 * Acquires a file lock during execution. The bounty cannot be refunded if it is already
 * finalized ("released" or "refunded") or if it has active submissions that need review.
 *
 * @param {string} id - The unique ID of the bounty.
 * @param {string} maintainer - The Stellar address of the maintainer requesting the refund.
 * @param {string} [transactionHash] - Optional Stellar transaction hash for the refund transaction.
 * @returns {Promise<BountyRecord>} A promise that resolves to the updated bounty record.
 * @throws {Error} If the bounty is not found.
 * @throws {Error} If the maintainer address does not match the maintainer of the bounty.
 * @throws {Error} If the bounty is already finalized ("released" or "refunded").
 * @throws {Error} If the bounty is in the "submitted" status and has not been reviewed.
 */
export async function refundBounty(
  id: string,
  maintainer: string,
  transactionHash?: string,
): Promise<BountyRecord> {
  return withStoreLock(async () => {
    const records = listBounties();
    const bounty = findBounty(records, id);

    if (bounty.maintainer !== maintainer) {
      throw new Error("Maintainer address does not match this bounty.");
    }
    if (bounty.status === "released" || bounty.status === "refunded") {
      throw new Error("This bounty is already finalized.");
    }
    if (bounty.status === "submitted") {
      throw new Error("Submitted bounties must be reviewed before refund.");
    }

    const now = nowInSeconds();
    const updated: BountyRecord = {
      ...bounty,
      status: "refunded",
      refundedAt: now,
      refundedTxHash: transactionHash?.trim()
        ? transactionHash.trim()
        : bounty.refundedTxHash,
      version: bounty.version + 1,
      events: [
        ...bounty.events,
        { type: "refunded", timestamp: now, actor: maintainer },
      ],
    };

    const persisted = persistUpdated(records, updated);
    appendAuditLogs([
      {
        bountyId: id,
        fromStatus: bounty.status,
        toStatus: "refunded",
        transition: "refund",
        actor: maintainer,
        metadata: {
          transactionHash: updated.refundedTxHash,
        },
      },
    ]);
    await invalidateBountyCache();

    if (persisted.contributor) {
      sendNotification(
        [{ role: "contributor", address: persisted.contributor }],
        "bounty_refunded",
        {
          bountyId: id,
          title: bounty.title,
          amount: bounty.amount,
          tokenSymbol: bounty.tokenSymbol,
        },
      ).catch((err) =>
        console.warn("[refundBounty] Notification failed (non-blocking):", err),
      );
    }

    return persisted;
  });
}

/**
 * Cancels an open bounty before reservation, returning escrow to the maintainer.
 *
 * Acquires a global lock during execution. Only works on bounties in "open" status.
 *
 * @param {string} id - The unique ID of the bounty.
 * @param {string} maintainer - The Stellar address of the maintainer requesting cancellation.
 * @param {string} [transactionHash] - Optional Stellar transaction hash for the cancellation.
 * @returns {Promise<BountyRecord>} A promise that resolves to the updated bounty record.
 * @throws {Error} If the bounty is not found.
 * @throws {Error} If the maintainer address does not match the maintainer of the bounty.
 * @throws {Error} If the bounty is not in "open" status.
 */
export async function cancelBounty(
  id: string,
  maintainer: string,
  transactionHash?: string,
): Promise<BountyRecord> {
  return withGlobalLock(async () => {
    const records = listBounties();
    const bounty = findBounty(records, id);

    if (bounty.maintainer !== maintainer) {
      throw new Error("Maintainer address does not match this bounty.");
    }
    if (bounty.status !== "open") {
      throw new Error("Only open bounties can be canceled.");
    }

    const now = nowInSeconds();
    const updated: BountyRecord = {
      ...bounty,
      status: "refunded",
      canceledAt: now,
      canceledTxHash: transactionHash?.trim()
        ? transactionHash.trim()
        : bounty.canceledTxHash,
      version: bounty.version + 1,
      events: [
        ...bounty.events,
        {
          type: "refunded",
          timestamp: now,
          actor: maintainer,
          details: { reason: "canceled" },
        },
      ],
    };

    const persisted = persistUpdated(records, updated);
    appendAuditLogs([
      {
        bountyId: id,
        fromStatus: bounty.status,
        toStatus: "refunded",
        transition: "cancel",
        actor: maintainer,
        metadata: {
          transactionHash: updated.canceledTxHash,
        },
      },
    ]);
    await invalidateBountyCache();
    return persisted;
  });
}

/**
 * Disputes a submitted bounty, transitioning it to "disputed" status.
 *
 * Acquires a file lock during execution. Only the contributor who submitted
 * the bounty can dispute it, and only when the bounty is in "submitted" status.
 *
 * @param {string} id - The unique ID of the bounty.
 * @param {string} contributor - The Stellar address of the contributor disputing the bounty.
 * @param {string} reason - The reason for disputing the bounty.
 * @returns {Promise<BountyRecord>} A promise that resolves to the updated bounty record.
 * @throws {Error} If the bounty is not found.
 * @throws {Error} If the contributor address does not match the bounty's contributor.
 * @throws {Error} If the bounty status is not "submitted".
 */
export async function disputeBounty(
  id: string,
  contributor: string,
  reason: string,
): Promise<BountyRecord> {
  return withStoreLock(async () => {
    const records = listBounties();
    const bounty = findBounty(records, id);

    if (bounty.status !== "submitted") {
      throw new Error("Only submitted bounties can be disputed.");
    }
    if (bounty.contributor !== contributor) {
      throw new Error("Only the contributor who submitted this bounty can dispute it.");
    }

    const now = nowInSeconds();
    const updated: BountyRecord = {
      ...bounty,
      status: "disputed",
      disputedAt: now,
      disputeReason: reason,
      version: bounty.version + 1,
      events: [
        ...bounty.events,
        {
          type: "disputed",
          timestamp: now,
          actor: contributor,
          details: { reason },
        },
      ],
    };

    const persisted = persistUpdated(records, updated);
    appendAuditLogs([
      {
        bountyId: id,
        fromStatus: bounty.status,
        toStatus: "disputed",
        transition: "dispute",
        actor: contributor,
        metadata: {
          reason,
        },
      },
    ]);
    await invalidateBountyCache();

    // Notify maintainer and arbiter about the dispute
    const recipients: NotificationRecipient[] = [
      { role: "maintainer", address: bounty.maintainer },
    ];
    if (bounty.contributor) {
      recipients.push({ role: "contributor", address: bounty.contributor });
    }

    sendNotification(recipients, "bounty_disputed", {
      bountyId: id,
      contributor,
      reason,
      disputedAt: now,
    }).catch((err) =>
      logStructured("warn", "notification_failed", {
        operation: "disputeBounty",
        bountyId: id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );

    return persisted;
  });
}

export async function updateBountyNotes(
  id: string,
  maintainer: string,
  notes: string,
): Promise<BountyRecord> {
  return withStoreLock(async () => {
    const records = listBounties();
    const bounty = findBounty(records, id);

    if (bounty.maintainer !== maintainer) {
      throw new Error("Maintainer address does not match this bounty.");
    }

    const now = nowInSeconds();
    const updated: BountyRecord = {
      ...bounty,
      notes,
      version: bounty.version + 1,
      events: [
        ...bounty.events,
        { type: "notes_updated", timestamp: now, actor: maintainer, details: { notes } },
      ],
    };

    const persisted = persistUpdated(records, updated);
    appendAuditLogs([
      {
        bountyId: id,
        fromStatus: bounty.status,
        toStatus: bounty.status, // same status, since we're just updating notes
        transition: "update_notes",
        actor: maintainer,
        metadata: { notes },
      },
    ]);
    await invalidateBountyCache();

    return persisted;
  });
}

/**
 * Extend a bounty's deadline. Only the bounty's maintainer may do this, and the
 * new deadline must be in the future and strictly later than the current one.
 * Records a `deadline_extended` event in the bounty's event log.
 */
export async function extendDeadline(
  id: string,
  maintainer: string,
  newDeadline: number,
): Promise<BountyRecord> {
  return withGlobalLock(async () => {
    const records = listBounties();
    const bounty = findBounty(records, id);

    if (bounty.maintainer !== maintainer) {
      throw new Error("Maintainer address does not match this bounty.");
    }

    const now = nowInSeconds();
    if (newDeadline <= now) {
      throw new Error("New deadline must be in the future.");
    }
    if (newDeadline <= bounty.deadlineAt) {
      throw new Error("New deadline must be later than the current deadline.");
    }

    const previousDeadline = bounty.deadlineAt;
    const updated: BountyRecord = {
      ...bounty,
      deadlineAt: newDeadline,
      version: bounty.version + 1,
      events: [
        ...bounty.events,
        {
          type: "deadline_extended",
          timestamp: now,
          actor: maintainer,
          details: { previousDeadline, newDeadline },
        },
      ],
    };

    const persisted = persistUpdated(records, updated);
    appendAuditLogs([
      {
        bountyId: id,
        fromStatus: bounty.status,
        toStatus: bounty.status, // status is unchanged by a deadline extension
        transition: "extend_deadline",
        actor: maintainer,
        metadata: { previousDeadline, newDeadline },
      },
    ]);
    await invalidateBountyCache();

    return persisted;
  });
}

/**
 * Paginated response structure containing a slice of bounty audit logs.
 */
export interface AuditLogPage {
  /** The list of audit log records on the current page. */
  data: BountyAuditLogRecord[];
  /** Pagination metadata. */
  pagination: {
    /** Total number of audit log records. */
    total: number;
    /** Current page number (1-indexed). */
    page: number;
    /** Number of records per page. */
    pageSize: number;
    /** Total number of pages. */
    totalPages: number;
  };
}

/**
 * Retrieves a paginated list of audit log records for a specific bounty.
 *
 * @param {string} bountyId - The unique ID of the bounty to retrieve audit logs for.
 * @param {number} [page=1] - The page number to retrieve (1-indexed).
 * @param {number} [pageSize=20] - The number of records per page.
 * @returns {AuditLogPage} A promise that resolves to a paginated response of audit log records.
 */
export function listBountyAuditLogs(
  bountyId: string,
  page: number = 1,
  pageSize: number = 20,
): AuditLogPage {
  const allLogs = readAuditStore();
  const filtered = allLogs.filter((log) => log.bountyId === bountyId);

  // Sort by timestamp descending (most recent first)
  filtered.sort((a, b) => b.timestamp - a.timestamp);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const data = filtered.slice(start, end);



export function getBountyEvents(bountyId: string): BountyEvent[] {
  const records = listBounties();
  const bounty = findBounty(records, bountyId);
  return bounty.events || [];
}


  };
}
 feat/concurrency-file-locking

const GLOBAL_METRICS_CACHE_KEY = "stats:global";
const GLOBAL_METRICS_TTL_SECONDS = 30;

/**
 * Cache-backed variant of {@link getGlobalMetrics} with a 30-second TTL.
 *
 * @param {CacheAdapter} [cache=getCache()] - The cache adapter to use for caching.
 * @returns {Promise<GlobalMetrics>} A promise that resolves to the global metrics.
 */
export async function getGlobalMetricsCached(
  cache: CacheAdapter = getCache(),
): Promise<GlobalMetrics> {
  const cached = await cache.get(GLOBAL_METRICS_CACHE_KEY);
  if (cached) {
    return JSON.parse(cached) as GlobalMetrics;
  }
  const metrics = getGlobalMetrics();
  await cache.set(GLOBAL_METRICS_CACHE_KEY, JSON.stringify(metrics), GLOBAL_METRICS_TTL_SECONDS);
  return metrics;
}

/**
 * Export object for aggregated metrics that can be reused across the application.
 * Provides both synchronous and cached variants of global metrics computation.
 */
export const aggregatedMetrics = {
  /**
   * Synchronous computation of global metrics.
   */
  getSync: getGlobalMetrics,
  /**
   * Cached computation of global metrics with 30-second TTL.
   */
  getCached: getGlobalMetricsCached,
};

export interface LeaderboardEntry {
  /** The Stellar address of the contributor. */
  address: string;
  /** Total reward tokens earned/released to the contributor. */
  totalXlm: number;
  /** Total number of successfully completed and released bounties. */
  bountiesCompleted: number;
}

/**
 * Retrieves a leaderboard of top contributors based on their earned token rewards and completed bounties.
 *
 * @param {number} [limit=10] - The maximum number of leaderboard entries to return.
 * @returns {LeaderboardEntry[]} A sorted array of leaderboard entries.
 */
export function getLeaderboard(limit = 10): LeaderboardEntry[] {
  const entries = new Map<string, LeaderboardEntry>();

  for (const bounty of listBounties()) {
    if (bounty.status !== "released" || !bounty.contributor) {
      continue;
    }

    const entry = entries.get(bounty.contributor) ?? {
      address: bounty.contributor,
      totalXlm: 0,
      bountiesCompleted: 0,
    };

    entry.totalXlm += bounty.amount;
    entry.bountiesCompleted += 1;
    entries.set(bounty.contributor, entry);
  }

  return Array.from(entries.values())
    .sort(
      (a, b) =>
        b.totalXlm - a.totalXlm || b.bountiesCompleted - a.bountiesCompleted,
    )
    .slice(0, limit);
}
 main
