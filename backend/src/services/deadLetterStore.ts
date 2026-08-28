import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger";

/**
 * Status of a dead-lettered notification entry.
 *
 * - "pending": Awaiting manual or automatic replay.
 * - "replayed": Successfully re-dispatched via admin replay.
 * - "discarded": Manually dismissed (no longer relevant).
 */
export type DeadLetterStatus = "pending" | "replayed" | "discarded";

/**
 * A single entry in the dead-letter queue representing a notification
 * that exhausted all retry attempts.
 */
export interface DeadLetterEntry {
  /** Unique identifier for this dead-letter entry. */
  id: string;
  /** The notification channel that failed (EMAIL or WEBHOOK). */
  channel: string;
  /** The event type that triggered the notification. */
  event: string;
  /** Serialized notification payload. */
  payload: Record<string, unknown>;
  /** Serialized recipient list. */
  recipients: Array<{ role: string; address: string }>;
  /** Error message from the last failed attempt. */
  lastError: string;
  /** Total number of dispatch attempts made (including retries). */
  attemptCount: number;
  /** Unix timestamp (ms) when the notification was first attempted. */
  createdAt: number;
  /** Unix timestamp (ms) of the most recent attempt. */
  lastAttemptAt: number;
  /** Current status in the dead-letter queue. */
  status: DeadLetterStatus;
  /** Error from replay attempt (if any). */
  replayError?: string;
  /** Unix timestamp (ms) when replay was attempted. */
  replayedAt?: number;
}

function getDeadLetterStorePath(): string {
  if (process.env.DEAD_LETTER_STORE_PATH?.trim()) {
    return path.resolve(process.env.DEAD_LETTER_STORE_PATH.trim());
  }
  return path.resolve(__dirname, "../../data/dead-letter.json");
}

function ensureStore(): void {
  const storePath = getDeadLetterStorePath();
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

function readStore(): DeadLetterEntry[] {
  ensureStore();
  return JSON.parse(
    fs.readFileSync(getDeadLetterStorePath(), "utf8"),
  ) as DeadLetterEntry[];
}

function writeStore(records: DeadLetterEntry[]): void {
  fs.writeFileSync(getDeadLetterStorePath(), JSON.stringify(records, null, 2));
}

function nextId(records: DeadLetterEntry[]): string {
  const highest = records.reduce((max, record) => {
    const numeric = Number(record.id.replace("DLQ-", ""));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
  return `DLQ-${String(highest + 1).padStart(8, "0")}`;
}

/**
 * Persist a failed notification to the dead-letter queue.
 *
 * @param entry - The dead-letter entry to record (id will be auto-assigned).
 * @returns The entry with its assigned ID.
 */
export function addToDeadLetter(entry: Omit<DeadLetterEntry, "id">): DeadLetterEntry {
  const records = readStore();
  const id = nextId(records);
  const record: DeadLetterEntry = { ...entry, id };
  writeStore([...records, record]);

  logger.warn(
    { deadLetterId: id, channel: entry.channel, event: entry.event, attemptCount: entry.attemptCount },
    "Notification added to dead-letter queue",
  );

  return record;
}

/**
 * Query dead-letter entries with optional filters.
 */
export function listDeadLetters(options: {
  limit?: number;
  offset?: number;
  status?: DeadLetterStatus;
  channel?: string;
  event?: string;
} = {}): {
  data: DeadLetterEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
} {
  const { limit = 50, offset = 0, status, channel, event } = options;
  let all = readStore();

  if (status) {
    all = all.filter((e) => e.status === status);
  }
  if (channel) {
    all = all.filter((e) => e.channel === channel.toUpperCase());
  }
  if (event) {
    all = all.filter((e) => e.event === event);
  }

  // Sort newest first
  all.sort((a, b) => b.createdAt - a.createdAt);

  const total = all.length;
  const data = all.slice(offset, offset + limit);
  const hasMore = offset + data.length < total;

  return { data, total, page: Math.floor(offset / limit) + 1, pageSize: limit, hasMore };
}

/**
 * Retrieve a single dead-letter entry by ID.
 */
export function getDeadLetter(id: string): DeadLetterEntry | undefined {
  return readStore().find((e) => e.id === id);
}

/**
 * Mark an entry as successfully replayed.
 */
export function markReplayed(id: string): boolean {
  const records = readStore();
  const idx = records.findIndex((e) => e.id === id);
  if (idx === -1) return false;

  records[idx] = {
    ...records[idx],
    status: "replayed" as const,
    replayedAt: Date.now(),
  };
  writeStore(records);
  return true;
}

/**
 * Mark an entry as discarded.
 */
export function markDiscarded(id: string): boolean {
  const records = readStore();
  const idx = records.findIndex((e) => e.id === id);
  if (idx === -1) return false;

  records[idx] = {
    ...records[idx],
    status: "discarded" as const,
  };
  writeStore(records);
  return true;
}

/**
 * Update the replay error for a failed replay attempt.
 */
export function updateReplayError(id: string, error: string): boolean {
  const records = readStore();
  const idx = records.findIndex((e) => e.id === id);
  if (idx === -1) return false;

  records[idx] = {
    ...records[idx],
    replayError: error,
    replayedAt: Date.now(),
  };
  writeStore(records);
  return true;
}

/**
 * Get aggregate counts of dead-letter entries by status.
 */
export function getDeadLetterStats(): {
  total: number;
  pending: number;
  replayed: number;
  discarded: number;
} {
  const all = readStore();
  return {
    total: all.length,
    pending: all.filter((e) => e.status === "pending").length,
    replayed: all.filter((e) => e.status === "replayed").length,
    discarded: all.filter((e) => e.status === "discarded").length,
  };
}
