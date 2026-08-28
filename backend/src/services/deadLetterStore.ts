import fs from "node:fs";
import path from "node:path";
import { logStructured } from "../logger";

const MAX_REPLAY_ATTEMPTS = 5;

/**
 * Represents an indexer event that failed processing and was captured
 * in the dead-letter store for later replay.
 */
export interface DeadLetterEvent {
  /** Unique identifier for this dead-letter record. */
  id: string;
  /** The original normalized event payload from the indexer. */
  rawEvent: Record<string, unknown>;
  /** The error message from the failed processing attempt. */
  errorMessage: string;
  /** ISO 8601 timestamp when the event was first dead-lettered. */
  createdAt: string;
  /** Number of replay attempts made so far. */
  replayCount: number;
  /** ISO 8601 timestamp of the last replay attempt, or null if never replayed. */
  lastReplayedAt: string | null;
  /** Status of this dead-letter entry. */
  status: "pending" | "replayed" | "failed" | "exhausted";
  /** History of replay attempts with their outcomes. */
  replayHistory: ReplayAttempt[];
}

export interface ReplayAttempt {
  /** ISO 8601 timestamp of the attempt. */
  timestamp: string;
  /** Whether the attempt succeeded. */
  success: boolean;
  /** Error message if the attempt failed. */
  error?: string;
}

function getStorePath(): string {
  if (process.env.DEAD_LETTER_STORE_PATH?.trim()) {
    return path.resolve(process.env.DEAD_LETTER_STORE_PATH.trim());
  }
  return path.resolve(__dirname, "../../data/dead-letter.json");
}

function ensureStore(): void {
  const storePath = getStorePath();
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

function readStore(): DeadLetterEvent[] {
  ensureStore();
  const storePath = getStorePath();
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8")) as DeadLetterEvent[];
  } catch {
    return [];
  }
}

function writeStore(records: DeadLetterEvent[]): void {
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(records, null, 2));
}

function nextId(records: DeadLetterEvent[]): string {
  const highest = records.reduce((max, record) => {
    const match = record.id.match(/^DL-(\d+)$/);
    if (!match) return max;
    const num = Number(match[1]);
    return Number.isFinite(num) ? Math.max(max, num) : max;
  }, 0);
  return `DL-${String(highest + 1).padStart(6, "0")}`;
}

/**
 * Captures a failed indexer event into the dead-letter store.
 *
 * @param rawEvent - The original event payload that failed processing.
 * @param errorMessage - The error message from the failed attempt.
 * @returns The created DeadLetterEvent record.
 */
export function deadLetterEvent(
  rawEvent: Record<string, unknown>,
  errorMessage: string,
): DeadLetterEvent {
  const records = readStore();
  const event: DeadLetterEvent = {
    id: nextId(records),
    rawEvent,
    errorMessage,
    createdAt: new Date().toISOString(),
    replayCount: 0,
    lastReplayedAt: null,
    status: "pending",
    replayHistory: [],
  };

  records.push(event);
  writeStore(records);

  logStructured("warn", "dead_letter_event_captured", {
    deadLetterId: event.id,
    errorMessage,
  });

  return event;
}

/**
 * Lists all dead-letter events, optionally filtered by status.
 */
export function listDeadLetterEvents(
  options: { status?: DeadLetterEvent["status"]; limit?: number; offset?: number } = {},
): { data: DeadLetterEvent[]; total: number } {
  const { status, limit = 50, offset = 0 } = options;
  let records = readStore();

  if (status) {
    records = records.filter((r) => r.status === status);
  }

  const total = records.length;
  const data = records.slice(offset, offset + limit);
  return { data, total };
}

/**
 * Gets a single dead-letter event by ID.
 */
export function getDeadLetterEvent(id: string): DeadLetterEvent | undefined {
  return readStore().find((r) => r.id === id);
}

/**
 * Updates a dead-letter event record after a replay attempt.
 */
function updateDeadLetterEvent(
  id: string,
  updater: (event: DeadLetterEvent) => DeadLetterEvent,
): DeadLetterEvent | undefined {
  const records = readStore();
  const index = records.findIndex((r) => r.id === id);
  if (index === -1) return undefined;

  records[index] = updater(records[index]);
  writeStore(records);
  return records[index];
}

/**
 * Marks a replay attempt on a dead-letter event and returns whether
 * the event should be retried.
 *
 * @param id - The dead-letter event ID.
 * @returns The updated event, or undefined if not found.
 */
export function recordReplayAttempt(id: string): DeadLetterEvent | undefined {
  return updateDeadLetterEvent(id, (event) => {
    const now = new Date().toISOString();
    const newCount = event.replayCount + 1;
    const exhausted = newCount >= MAX_REPLAY_ATTEMPTS;

    return {
      ...event,
      replayCount: newCount,
      lastReplayedAt: now,
      status: exhausted ? "exhausted" : "pending",
    };
  });
}

/**
 * Marks a dead-letter event as successfully replayed or failed.
 * If the event has reached MAX_REPLAY_ATTEMPTS, it is marked as exhausted
 * regardless of the replay outcome.
 */
export function markReplaySuccess(id: string, replayError?: string): DeadLetterEvent | undefined {
  return updateDeadLetterEvent(id, (event) => {
    const attempt: ReplayAttempt = {
      timestamp: event.lastReplayedAt ?? new Date().toISOString(),
      success: !replayError,
      error: replayError,
    };

    let status: DeadLetterEvent["status"];
    if (event.replayCount >= MAX_REPLAY_ATTEMPTS) {
      status = "exhausted";
    } else if (replayError) {
      status = "failed";
    } else {
      status = "replayed";
    }

    return {
      ...event,
      status,
      replayHistory: [...event.replayHistory, attempt],
    };
  });
}

/**
 * Removes all dead-letter events that have been successfully replayed.
 * Returns the number of records removed.
 */
export function purgeReplayedEvents(): number {
  const records = readStore();
  const before = records.length;
  const remaining = records.filter((r) => r.status !== "replayed");
  writeStore(remaining);
  return before - remaining.length;
}

/**
 * Returns a summary of dead-letter event counts per status.
 */
export function getDeadLetterMetrics(): Record<string, number> {
  const records = readStore();
  const summary: Record<string, number> = {
    total: records.length,
    pending: 0,
    replayed: 0,
    failed: 0,
    exhausted: 0,
  };

  for (const record of records) {
    summary[record.status] = (summary[record.status] ?? 0) + 1;
  }

  return summary;
}
