import fs from "node:fs";
import path from "node:path";
import {
  getNotificationService,
  createNotificationPayload,
  type NotificationEvent,
} from "./notificationService";

export type BountyStatus =
  | "open"
  | "reserved"
  | "submitted"
  | "released"
  | "refunded"
  | "expired";

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
  refundedAt?: number;
  submissionUrl?: string;
  notes?: string;
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
}

function getStorePath(): string {
  if (process.env.BOUNTY_STORE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_STORE_PATH.trim());
  }
  return path.resolve(__dirname, "../../data/bounties.json");
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
  },
];

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function ensureStore(): void {
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify(sampleBounties, null, 2));
    return;
  }

  const raw = fs.readFileSync(storePath, "utf8").trim();
  if (!raw) {
    fs.writeFileSync(storePath, JSON.stringify(sampleBounties, null, 2));
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

function normalizeRecords(records: BountyRecord[]): BountyRecord[] {
  const now = nowInSeconds();
  let changed = false;

  const next = records.map((record) => {
    if ((record.status === "open" || record.status === "reserved") && now > record.deadlineAt) {
      changed = true;
      return {
        ...record,
        status: "expired" as const,
      };
    }
    return record;
  });

  if (changed) {
    writeStore(next);
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

export function listBounties(): BountyRecord[] {
  const records = normalizeRecords(readStore());
  return [...records].sort((a, b) => b.createdAt - a.createdAt);
}

export function createBounty(input: CreateBountyInput): BountyRecord {
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
  };

  writeStore([bounty, ...records]);
  return bounty;
}

export function reserveBounty(id: string, contributor: string): BountyRecord {
  const records = listBounties();
  const bounty = findBounty(records, id);

  if (bounty.status !== "open") {
    throw new Error("Only open bounties can be reserved.");
  }

  const updated: BountyRecord = {
    ...bounty,
    contributor,
    status: "reserved",
    reservedAt: nowInSeconds(),
  };

  const result = persistUpdated(records, updated);

  // Trigger notification (fire and forget)
  const notificationService = getNotificationService();
  notificationService.send(
    createNotificationPayload("bounty_reserved", result, { contributor })
  ).catch(() => {
    // Fail silently - notifications should not break core functionality
  });

  return result;
}

export function submitBounty(
  id: string,
  contributor: string,
  submissionUrl: string,
  notes?: string,
): BountyRecord {
  const records = listBounties();
  const bounty = findBounty(records, id);

  if (bounty.status !== "reserved") {
    throw new Error("Only reserved bounties can be submitted.");
  }
  if (bounty.contributor !== contributor) {
    throw new Error("Only the reserved contributor can submit this bounty.");
  }

  const updated: BountyRecord = {
    ...bounty,
    status: "submitted",
    submittedAt: nowInSeconds(),
    submissionUrl,
    notes,
  };

  const result = persistUpdated(records, updated);

  // Trigger notification (fire and forget)
  const notificationService = getNotificationService();
  notificationService.send(
    createNotificationPayload("bounty_submitted", result, { submissionUrl, notes })
  ).catch(() => {
    // Fail silently - notifications should not break core functionality
  });

  return result;
}

export function releaseBounty(id: string, maintainer: string): BountyRecord {
  const records = listBounties();
  const bounty = findBounty(records, id);

  if (bounty.maintainer !== maintainer) {
    throw new Error("Maintainer address does not match this bounty.");
  }
  if (bounty.status !== "submitted") {
    throw new Error("Only submitted bounties can be released.");
  }

  const updated: BountyRecord = {
    ...bounty,
    status: "released",
    releasedAt: nowInSeconds(),
  };

  const result = persistUpdated(records, updated);

  // Trigger notification (fire and forget)
  const notificationService = getNotificationService();
  notificationService.send(
    createNotificationPayload("bounty_released", result)
  ).catch(() => {
    // Fail silently - notifications should not break core functionality
  });

  return result;
}

export function refundBounty(id: string, maintainer: string): BountyRecord {
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

  const updated: BountyRecord = {
    ...bounty,
    status: "refunded",
    refundedAt: nowInSeconds(),
  };

  const result = persistUpdated(records, updated);

  // Trigger notification (fire and forget)
  const notificationService = getNotificationService();
  notificationService.send(
    createNotificationPayload("bounty_refunded", result)
  ).catch(() => {
    // Fail silently - notifications should not break core functionality
  });

  return result;
}

