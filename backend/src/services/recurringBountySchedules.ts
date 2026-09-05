import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CreateBountyInput } from "./bountyStore";
import { createBounty } from "./bountyStore";
import { applyBountyTemplate } from "./bountyTemplates";
import { createBountySchema } from "../validation/schemas";

export type ScheduleCadence = "daily" | "weekly" | "monthly";

export interface RecurringBountySchedule {
  id: string;
  cadence: ScheduleCadence;
  templateId: string;
  targetRepo: string;
  bounty: Omit<CreateBountyInput, "repo">;
  active: boolean;
  createdAt: number;
  nextRunAt: number;
  lastRunAt?: number;
  createdBountyIds: string[];
}

const CADENCE_SECONDS: Record<ScheduleCadence, number> = {
  daily: 86_400,
  weekly: 604_800,
  monthly: 2_592_000,
};

function schedulePath(): string {
  if (process.env.RECURRING_BOUNTY_STORE_PATH?.trim()) return path.resolve(process.env.RECURRING_BOUNTY_STORE_PATH.trim());
  if (process.env.BOUNTY_STORE_PATH?.trim()) return path.resolve(process.env.BOUNTY_STORE_PATH.trim().replace(/\.json$/i, ".schedules.json"));
  return path.resolve(__dirname, "../../data/recurring-bounty-schedules.json");
}

function read(): RecurringBountySchedule[] {
  const file = schedulePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || !fs.readFileSync(file, "utf8").trim()) fs.writeFileSync(file, "[]");
  return JSON.parse(fs.readFileSync(file, "utf8")) as RecurringBountySchedule[];
}

function write(records: RecurringBountySchedule[]): void {
  fs.writeFileSync(schedulePath(), JSON.stringify(records, null, 2));
}

export function listRecurringSchedules(): RecurringBountySchedule[] {
  return read();
}

export function createRecurringSchedule(input: {
  cadence: ScheduleCadence;
  templateId: string;
  targetRepo: string;
  bounty: Omit<CreateBountyInput, "repo">;
  startAt?: number;
}): RecurringBountySchedule {
  const now = Math.floor(Date.now() / 1000);
  const schedule: RecurringBountySchedule = {
    id: randomUUID(),
    cadence: input.cadence,
    templateId: input.templateId,
    targetRepo: input.targetRepo,
    bounty: input.bounty,
    active: true,
    createdAt: now,
    nextRunAt: input.startAt ?? now + CADENCE_SECONDS[input.cadence],
    createdBountyIds: [],
  };
  const records = read();
  write([...records, schedule]);
  return schedule;
}

export function cancelRecurringSchedule(id: string): RecurringBountySchedule {
  const records = read();
  const schedule = records.find((item) => item.id === id);
  if (!schedule) throw new Error("Recurring bounty schedule not found.");
  schedule.active = false;
  write(records);
  return schedule;
}

let running = false;
export async function runDueRecurringSchedules(now = Math.floor(Date.now() / 1000)): Promise<string[]> {
  if (running) return [];
  running = true;
  try {
    const records = read();
    const created: string[] = [];
    for (const schedule of records) {
      if (!schedule.active || schedule.nextRunAt > now) continue;
      const merged = applyBountyTemplate({
        templateId: schedule.templateId,
        ...schedule.bounty,
        repo: schedule.targetRepo,
      });
      const input = createBountySchema.parse(merged);
      const bounty = await createBounty(input);
      schedule.lastRunAt = now;
      schedule.createdBountyIds.push(bounty.id);
      do schedule.nextRunAt += CADENCE_SECONDS[schedule.cadence]; while (schedule.nextRunAt <= now);
      created.push(bounty.id);
    }
    write(records);
    return created;
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startRecurringBountyScheduler(intervalMs = 60_000): void {
  if (timer) return;
  void runDueRecurringSchedules();
  timer = setInterval(() => void runDueRecurringSchedules(), intervalMs);
  timer.unref();
}

export function stopRecurringBountyScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
