import fs from "node:fs";
import path from "node:path";
import { sendNotification, type NotificationRecipient } from "./notificationService";
import { logStructured } from "../logger";
import { getCache, type CacheAdapter } from "./cache";

export type BountyStatus =
  | "open"
  | "reserved"
  | "submitted"
  | "released"
  | "refunded"
  | "expired";

export type BountyTransitionType = "reserve" | "submit" | "release" | "refund" | "expire";

export type AuditMetadataValue = string | number | boolean | null;

export interface BountyEvent {
  type: "created" | "reserved" | "submitted" | "released" | "refunded" | "expired";
  timestamp: number;
  actor?: string;
  details?: Record<string, unknown>;
}

export interface BountyAuditLogRecord {
  id: string;
  bountyId: string;
  fromStatus: BountyStatus;
  toStatus: BountyStatus;
  transition: BountyTransitionType;
  actor: string;
  timestamp: number;
  metadata?: Record<string, AuditMetadataValue>;
}

export interface BountyRecord {
  id: string;
  repo: string;
  issueNumber: number;
  title: string;
  summary: string;
  maintainer: string;
  contributor?: string;
  tokenSymbol: string;
  amount: number;
  labels: string[];
  status: BountyStatus;
  createdAt: number;
  deadlineAt: number;
  reservedAt?: number;
  submittedAt?: number;
  releasedAt?: number;
  releasedTxHash?: string;
  refundedAt?: number;
  refundedTxHash?: string;
  submissionUrl?: string;
  notes?: string;
  // Race condition prevention
  version: number;
  // Event history
  events: BountyEvent[];
  // Reservation timeout (in seconds from reservation)
  reservationTimeoutSeconds?: number;
}

export interface CreateBountyInput {
  repo: string;
  issueNumber: number;
  title: string;
  summary: string;
  maintainer: string;
  tokenSymbol: string;
  amount: number;
  deadlineDays: number;
  labels: string[];
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
  return base.endsWith(".json") ? base.replace(/\.json$/i, ".audit.json") : `${base}.audit.json`;
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
      { type: "reserved", timestamp: 1710003600, actor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" },
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
  return JSON.parse(fs.readFileSync(getAuditStorePath(), "utf8")) as BountyAuditLogRecord[];
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

  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
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
    const events: BountyEvent[] = record.events || [{ type: "created" as const, timestamp: record.createdAt }];

    // Check for expired deadline
    if ((record.status === "open" || record.status === "reserved") && now > record.deadlineAt) {
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
        events: [
          ...events,
          { type: "expired" as const, timestamp: now },
        ],
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
          { type: "expired" as const, timestamp: now, details: { reason: "reservation_timeout" } },
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

function persistUpdated(records: BountyRecord[], updated: BountyRecord): BountyRecord {
  const next = records.map((record) => (record.id === updated.id ? updated : record));
  writeStore(next);
  return updated;
}

export interface ListBountiesOptions {
  /** Case-insensitive substring filter applied to title, summary, and labels. */
  q?: string;
}

export function listBounties(options: ListBountiesOptions = {}): BountyRecord[] {
  const records = normalizeRecords(readStore());
  let sorted = [...records].sort((a, b) => b.createdAt - a.createdAt);

  const q = options.q?.trim().toLowerCase();
  if (q) {
    sorted = sorted.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.summary.toLowerCase().includes(q) ||
        b.labels.some((l) => l.toLowerCase().includes(q)),
    );
  }

  return sorted;
}

// ── Cached list for the public board (#361) ──────────────────────────────────

const BOUNTY_LIST_CACHE_KEY = "bounties:list";
const BOUNTY_LIST_TTL_SECONDS = 5;

/**
 * Cache-backed variant of {@link listBounties} for the hot `/api/bounties` read
 * path. The full normalized+sorted list is cached (5s TTL) so it is shared
 * across replicas via Redis; the cheap `q` filter is applied to the cached list
 * per request. Writes call {@link invalidateBountyCache}.
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

/** Drop the cached bounty list so the next read reflects a mutation (#361). */
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

export async function createBounty(input: CreateBountyInput): Promise<BountyRecord> {
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

    // Trigger notification on create
    const recipients: NotificationRecipient[] = [{ role: "maintainer", address: input.maintainer }];

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
    }).catch((err) => console.warn("[createBounty] Notification failed (non-blocking):", err));

    return bounty;
  });
}

export async function reserveBounty(id: string, contributor: string, expectedVersion?: number): Promise<BountyRecord> {
  return withGlobalLock(async () => {
    const records = listBounties();
    const bounty = findBounty(records, id);

    if (bounty.status !== "open") {
      throw new Error("Only open bounties can be reserved.");
    }

    // Race condition prevention: check version if provided
    if (expectedVersion !== undefined && bounty.version !== expectedVersion) {
      throw new Error("Bounty was just reserved by someone else. Please refresh and try again.");
    }

    const now = nowInSeconds();
    const updated: BountyRecord = {
      ...bounty,
      contributor,
      status: "reserved",
      reservedAt: now,
      version: bounty.version + 1,
      events: [...bounty.events, { type: "reserved", timestamp: now, actor: contributor }],
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
      events: [...bounty.events, { type: "submitted", timestamp: now, actor: contributor }],
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
      releasedTxHash: transactionHash?.trim() ? transactionHash.trim() : bounty.releasedTxHash,
      version: bounty.version + 1,
      events: [...bounty.events, { type: "released", timestamp: now, actor: maintainer }],
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
      refundedTxHash: transactionHash?.trim() ? transactionHash.trim() : bounty.refundedTxHash,
      version: bounty.version + 1,
      events: [...bounty.events, { type: "refunded", timestamp: now, actor: maintainer }],
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

export interface AuditLogPage {
  data: BountyAuditLogRecord[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

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

export function getBountyEvents(bountyId: string): BountyEvent[] {
  const records = listBounties();
  const bounty = records.find((b) => b.id === bountyId);
  if (!bounty) {
    throw new Error(`Bounty ${bountyId} not found.`);
  }
  return bounty.events ?? [];
}

export interface MaintainerMetrics {
  totalBounties: number;
  openCount: number;
  reservedCount: number;
  submittedCount: number;
  releasedCount: number;
  refundedCount: number;
  expiredCount: number;
  totalFunded: number;
  totalReleased: number;
  averageRewardAmount: number;
}

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
    averageRewardAmount: bounties.length > 0 ? totalFunded / bounties.length : 0,
  };
}

export interface GlobalMetrics {
  totalBounties: number;
  openCount: number;
  reservedCount: number;
  submittedCount: number;
  releasedCount: number;
  refundedCount: number;
  expiredCount: number;
  totalFunded: number;
  totalReleased: number;
  uniqueMaintainers: number;
  uniqueContributors: number;
}

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
  address: string;
  totalXlm: number;
  bountiesCompleted: number;
}

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
    .sort((a, b) => b.totalXlm - a.totalXlm || b.bountiesCompleted - a.bountiesCompleted)
    .slice(0, limit);
}
