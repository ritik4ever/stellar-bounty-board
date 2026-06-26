import fs from "node:fs";
import path from "node:path";
import {
  sendNotification,
  type NotificationRecipient,
} from "./notificationService";
import { logStructured } from "../logger";
import { getCache, type CacheAdapter } from "./cache";
import { bountiesCreatedTotal, bountiesReleasedTotal } from "../metrics";

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
  | "expire"
  | "dispute";

/**
 * Represents a historical event in the lifecycle of a bounty.
 */
export interface BountyEvent {
  /** The type of event (usually matches the resulting status or "created"). */
  type: BountyStatus | "created";
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
  /** Unix timestamp in seconds of when the bounty was refunded. */
  refundedAt?: number;
  /** Stellar transaction hash of the refund payment. */
  refundedTxHash?: string;
  /** URL to the submission solution (e.g., Pull Request link). */
  submissionUrl?: string;
  /** Submission notes left by the contributor. */
  notes?: string;
  /** Unix timestamp in seconds of when the bounty was disputed. */
  disputedAt?: number;
  /** Reason provided by the contributor for disputing the bounty. */
  disputeReason?: string;
  /** Notes recorded by the arbiter when resolving a dispute. */
  resolutionNotes?: string;
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
}

export function listBounties(options: ListBountiesOptions = {}): BountyRecord[] {
  const records = normalizeRecords(readStore());
  const q = options.q?.trim().toLowerCase();

  // Single-pass: filter and copy in one iteration, then sort.
  // Avoids the prior two-pass pattern of spread-sort then filter.
  const result: BountyRecord[] = [];
  for (let i = 0; i < records.length; i++) {
    const b = records[i];
    if (
      !q ||
      b.title.toLowerCase().includes(q) ||
      b.summary.toLowerCase().includes(q) ||
      b.labels.some((l) => l.toLowerCase().includes(q))
    ) {
      result.push(b);
    }
  }

  result.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}

// ── Cached list for the public board (#361) ──────────────────────────────────

const BOUNTY_LIST_CACHE_KEY = "bounties:list";
const BOUNTY_LIST_TTL_SECONDS = 5;

/**
 * Cache-backed variant of {@link listBounties} for the hot `/api/bounties` read
 * path. The full normalized+sorted list is cached (5s TTL) so it is shared
 * across replicas via Redis; the cheap `q` filter is applied to the cached list
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
  if (!q) {
    return records;
  }
  return records.filter(
    (b) =>
      b.title.toLowerCase().includes(q) ||
      b.summary.toLowerCase().includes(q) ||
      b.labels.some((l) => l.toLowerCase().includes(q)),
  );
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

let globalLock: Promise<void> = Promise.resolve();

async function withGlobalLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const previousLock = globalLock;
  let resolve: () => void;
  globalLock = new Promise<void>((r) => {
    resolve = r;
  });
  await previousLock;
  try {
    return await fn();
  } finally {
    resolve!();
  }
}

export async function createBounty(
  input: CreateBountyInput,
): Promise<BountyRecord> {
  return withGlobalLock(async () => {
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

    // Increment Prometheus counter for bounty creation
    bountiesCreatedTotal.inc();

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
      console.warn("[createBounty] Notification failed (non-blocking):", err),
    );

    return bounty;
  });
}

export async function reserveBounty(
  id: string,
  contributor: string,
  expectedVersion?: number,
): Promise<BountyRecord> {
  return withGlobalLock(async () => {
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
    return persisted;
  });
}

/**
 * Submits a solution for a reserved bounty.
 *
 * Acquires a global lock during execution. The bounty status transitions from "reserved" to "submitted".
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
  return withGlobalLock(async () => {
    const records = listBounties();
    const bounty = findBounty(records, id);

    if (bounty.status !== "reserved") {
      throw new Error("Only reserved bounties can be submitted.");
    }
    if (bounty.contributor !== contributor) {
      throw new Error("Only the reserved contributor can submit this bounty.");
    }

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
    return persisted;
  });
}

/**
 * Releases the funds for a submitted bounty, marking it as finalized.
 *
 * Acquires a global lock during execution. Transitions the bounty status to "released".
 *
 * @param {string} id - The unique ID of the bounty.
 * @param {string} maintainer - The Stellar address of the maintainer releasing the bounty.
 * @param {string} [transactionHash] - Optional Stellar transaction hash for the payment.
 * @returns {Promise<BountyRecord>} A promise that resolves to the updated bounty record.
 * @throws {Error} If the bounty is not found.
 * @throws {Error} If the maintainer address does not match the maintainer who created the bounty.
 * @throws {Error} If the bounty status is not "submitted".
 */
export async function releaseBounty(
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

    // Increment Prometheus counter for bounty release
    bountiesReleasedTotal.inc();

    return persisted;
  });
}

/**
 * Refunds the bounty funds back to the maintainer.
 *
 * Acquires a global lock during execution. The bounty cannot be refunded if it is already
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
  return withGlobalLock(async () => {
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
    return persisted;
  });
}

/**
 * Disputes a submitted bounty, transitioning it to "disputed" status.
 *
 * Acquires a global lock during execution. Only the contributor who submitted
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
  return withGlobalLock(async () => {
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
      console.warn("[disputeBounty] Notification failed (non-blocking):", err),
    );

    return persisted;
  });
}

/**
 * Resolves a disputed bounty, transitioning it to either released or refunded.
 *
 * @param {string} id - The unique ID of the bounty.
 * @param {string} arbiter - The Stellar address of the arbiter resolving the dispute.
 * @param {boolean} release - When true, release funds to contributor; otherwise refund maintainer.
 * @param {string} [resolutionNotes] - Optional notes from the arbiter.
 */
export async function resolveDisputeBounty(
  id: string,
  arbiter: string,
  release: boolean,
  resolutionNotes?: string,
): Promise<BountyRecord> {
  return withGlobalLock(async () => {
    const records = listBounties();
    const bounty = findBounty(records, id);

    if (bounty.status !== "disputed") {
      throw new Error("Only disputed bounties can be resolved.");
    }

    const configuredArbiter = process.env.ARBITER_ADDRESS?.trim();
    if (configuredArbiter && arbiter !== configuredArbiter) {
      throw new Error("Arbiter address is not authorized to resolve this dispute.");
    }

    const now = nowInSeconds();
    const trimmedNotes = resolutionNotes?.trim() || undefined;

    if (release) {
      const updated: BountyRecord = {
        ...bounty,
        status: "released",
        releasedAt: now,
        resolutionNotes: trimmedNotes,
        version: bounty.version + 1,
        events: [
          ...bounty.events,
          { type: "released", timestamp: now, actor: arbiter },
        ],
      };

      const persisted = persistUpdated(records, updated);
      appendAuditLogs([
        {
          bountyId: id,
          fromStatus: "disputed",
          toStatus: "released",
          transition: "release",
          actor: arbiter,
          metadata: {
            release: true,
            ...(trimmedNotes ? { resolutionNotes: trimmedNotes } : {}),
          },
        },
      ]);
      await invalidateBountyCache();
      bountiesReleasedTotal.inc();
      return persisted;
    }

    const updated: BountyRecord = {
      ...bounty,
      status: "refunded",
      refundedAt: now,
      resolutionNotes: trimmedNotes,
      version: bounty.version + 1,
      events: [
        ...bounty.events,
        { type: "refunded", timestamp: now, actor: arbiter },
      ],
    };

    const persisted = persistUpdated(records, updated);
    appendAuditLogs([
      {
        bountyId: id,
        fromStatus: "disputed",
        toStatus: "refunded",
        transition: "refund",
        actor: arbiter,
        metadata: {
          release: false,
          ...(trimmedNotes ? { resolutionNotes: trimmedNotes } : {}),
        },
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
    /** The limit applied to the query. */
    limit: number;
    /** The offset applied to the query. */
    offset: number;
    /** Total number of matching records in the system. */
    total: number;
    /** Indicates if more records are available. */
    hasMore: boolean;
    /** The next offset to query, or null if there are no more records. */
    nextOffset: number | null;
  };
}

/**
 * Retrieves paginated audit logs for a specific bounty.
 *
 * @param {string} bountyId - The unique ID of the bounty.
 * @param {Object} [options={}] - Pagination options.
 * @param {number} [options.limit=20] - The maximum number of log records to return.
 * @param {number} [options.offset=0] - The starting index for pagination.
 * @returns {AuditLogPage} An object containing the requested page of audit logs and pagination metadata.
 */
export function listBountyAuditLogs(
  bountyId: string,
  options: { limit?: number; offset?: number } = {},
): AuditLogPage {
  const { limit = 20, offset = 0 } = options;
  const all = readAuditStore().filter((log) => log.bountyId === bountyId);
  const total = all.length;
  const data = all.slice(offset, offset + limit);
  const hasMore = offset + limit < total;
  return {
    data,
    pagination: {
      limit,
      offset,
      total,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    },
  };
}

/**

export function getBountyEvents(bountyId: string): BountyEvent[] {
  const records = listBounties();
  const bounty = records.find((b) => b.id === bountyId);
  if (!bounty) {
    throw new Error(`Bounty ${bountyId} not found.`);
  }
  return bounty.events ?? [];
}

/**
 * Aggregate metrics and performance tracking data for a maintainer.
 */
export interface MaintainerMetrics {
  /** The total number of bounties created by the maintainer. */
  totalBounties: number;
  /** Count of bounties currently in "open" status. */
  openCount: number;
  /** Count of bounties currently in "reserved" status. */
  reservedCount: number;
  /** Count of bounties currently in "submitted" status. */
  submittedCount: number;
  /** Count of bounties successfully "released" status. */
  releasedCount: number;
  /** Count of bounties refunded. */
  refundedCount: number;
  /** Count of bounties that have expired. */
  expiredCount: number;
  /** Total value of rewards funded by this maintainer. */
  totalFunded: number;
  /** Total value of rewards paid out/released to contributors. */
  totalReleased: number;
  /** Average reward value for the maintainer's bounties. */
  averageRewardAmount: number;
}

/**
 * Computes and returns aggregated metrics for a specific maintainer.
 *
 * @param {string} maintainer - The Stellar address of the maintainer.
 * @returns {MaintainerMetrics} An object containing counts, sums, and averages of the maintainer's bounties.
 */
export function getMaintainerMetrics(maintainer: string): MaintainerMetrics {
  const bounties = listBounties().filter((b) => b.maintainer === maintainer);
  const totalFunded = bounties.reduce((sum, b) => sum + b.amount, 0);
  const released = bounties.filter((b) => b.status === "released");
  const totalReleased = released.reduce((sum, b) => sum + b.amount, 0);
  return {
    totalBounties: bounties.length,
    openCount: bounties.filter((b) => b.status === "open").length,
    reservedCount: bounties.filter((b) => b.status === "reserved").length,
    submittedCount: bounties.filter((b) => b.status === "submitted").length,
    releasedCount: released.length,
    refundedCount: bounties.filter((b) => b.status === "refunded").length,
    expiredCount: bounties.filter((b) => b.status === "expired").length,
    totalFunded,
    totalReleased,
    averageRewardAmount:
      bounties.length > 0 ? totalFunded / bounties.length : 0,
  };
}

/**
 * Ecosystem-wide aggregate statistics across all platform activity.
 */
export interface GlobalMetrics {
  /** Total number of bounties created across the platform. */
  totalBounties: number;
  /** Total count of open bounties. */
  openCount: number;
  /** Total count of reserved bounties. */
  reservedCount: number;
  /** Total count of submitted bounties. */
  submittedCount: number;
  /** Total count of released bounties. */
  releasedCount: number;
  /** Total count of refunded bounties. */
  refundedCount: number;
  /** Total count of expired bounties. */
  expiredCount: number;
  /** Total amount of tokens funded across the platform. */
  totalFunded: number;
  /** Total amount of tokens released to contributors. */
  totalReleased: number;
  /** Total number of unique maintainer addresses. */
  uniqueMaintainers: number;
  /** Total number of unique contributor addresses. */
  uniqueContributors: number;
}

/**
 * Computes and returns global ecosystem-wide metrics for all bounties.
 *
 * @returns {GlobalMetrics} An object summarizing total counts, funding, and unique actor metrics.
 */
export function getGlobalMetrics(): GlobalMetrics {
  const bounties = listBounties();
  const totalFunded = bounties.reduce((sum, b) => sum + b.amount, 0);
  const released = bounties.filter((b) => b.status === "released");
  const totalReleased = released.reduce((sum, b) => sum + b.amount, 0);
  const uniqueMaintainers = new Set(bounties.map((b) => b.maintainer)).size;
  const uniqueContributors = new Set(
    bounties.filter((b) => b.contributor).map((b) => b.contributor as string),
  ).size;
  return {
    totalBounties: bounties.length,
    openCount: bounties.filter((b) => b.status === "open").length,
    reservedCount: bounties.filter((b) => b.status === "reserved").length,
    submittedCount: bounties.filter((b) => b.status === "submitted").length,
    releasedCount: released.length,
    refundedCount: bounties.filter((b) => b.status === "refunded").length,
    expiredCount: bounties.filter((b) => b.status === "expired").length,
    totalFunded,
    totalReleased,
    uniqueMaintainers,
    uniqueContributors,
  };
}


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
