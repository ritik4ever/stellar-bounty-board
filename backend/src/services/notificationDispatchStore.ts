import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface NotificationDispatchRecord {
  id: string;
  bountyId: string;
  event: string;
  channel: "EMAIL" | "WEBHOOK";
  recipientRole: string;
  recipientAddress: string;
  timestamp: number;
}

const testRecords: NotificationDispatchRecord[] = [];

function getStorePath(): string {
  if (process.env.BOUNTY_NOTIFICATION_STORE_PATH?.trim()) {
    return path.resolve(process.env.BOUNTY_NOTIFICATION_STORE_PATH.trim());
  }

  const base = process.env.BOUNTY_STORE_PATH?.trim()
    ? path.resolve(process.env.BOUNTY_STORE_PATH.trim())
    : path.resolve(__dirname, "../../data/bounties.json");

  return base.endsWith(".json")
    ? base.replace(/\.json$/i, ".notifications.json")
    : `${base}.notifications.json`;
}

function readRecords(): NotificationDispatchRecord[] {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) return [];

  const raw = fs.readFileSync(storePath, "utf8").trim();
  return raw ? (JSON.parse(raw) as NotificationDispatchRecord[]) : [];
}

function writeRecords(records: NotificationDispatchRecord[]): void {
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(records, null, 2), "utf8");
}

export function recordNotificationDispatch(input: Omit<NotificationDispatchRecord, "id">): void {
  const record = { ...input, id: `NOT-${randomUUID()}` };
  if (process.env.NODE_ENV === "test") {
    testRecords.push(record);
    return;
  }

  writeRecords([...readRecords(), record]);
}

export function listNotificationDispatches(bountyId?: string): NotificationDispatchRecord[] {
  const records = process.env.NODE_ENV === "test" ? testRecords : readRecords();
  return records
    .filter((record) => !bountyId || record.bountyId === bountyId)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function __resetNotificationDispatchesForTests(): void {
  testRecords.length = 0;
}
