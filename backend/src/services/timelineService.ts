import { getCache, type CacheAdapter } from "./cache";
import { listBountyAuditLogs, listBounties, type BountyEvent } from "./bountyStore";
import {
  listNotificationDispatches,
  type NotificationDispatchRecord,
} from "./notificationDispatchStore";

export interface BountyTimelineEntry {
  id: string;
  bountyId: string;
  source: "contract" | "audit" | "notification";
  type: string;
  actor?: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

const TIMELINE_TTL_SECONDS = 5;

function contractEntry(bountyId: string, event: BountyEvent, index: number): BountyTimelineEntry {
  return {
    id: `${bountyId}:contract:${index}`,
    bountyId,
    source: "contract",
    type: event.type,
    actor: event.actor,
    timestamp: event.timestamp,
    details: event.details,
  };
}

function notificationEntry(
  record: NotificationDispatchRecord,
): BountyTimelineEntry {
  return {
    id: record.id,
    bountyId: record.bountyId,
    source: "notification",
    type: record.event,
    actor: record.recipientAddress,
    timestamp: record.timestamp,
    details: {
      channel: record.channel,
      recipientRole: record.recipientRole,
    },
  };
}

export async function getBountyTimeline(
  bountyId: string,
  cache: CacheAdapter = getCache(),
): Promise<BountyTimelineEntry[]> {
  const cacheKey = `bounty:timeline:${bountyId}`;
  const cached = await cache.get(cacheKey);
  if (cached) return JSON.parse(cached) as BountyTimelineEntry[];

  const bounty = listBounties().find((record) => record.id === bountyId);
  if (!bounty) throw new Error("Bounty not found.");

  const auditLogs = listBountyAuditLogs(bountyId, { limit: 10_000 }).data;
  const entries: BountyTimelineEntry[] = [
    ...bounty.events.map((event, index) => contractEntry(bountyId, event, index)),
    ...auditLogs.map((log) => ({
      id: log.id,
      bountyId,
      source: "audit" as const,
      type: log.transition,
      actor: log.actor,
      timestamp: log.timestamp,
      details: {
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        ...log.metadata,
      },
    })),
    ...listNotificationDispatches(bountyId).map(notificationEntry),
  ];

  entries.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  await cache.set(cacheKey, JSON.stringify(entries), TIMELINE_TTL_SECONDS);
  return entries;
}
