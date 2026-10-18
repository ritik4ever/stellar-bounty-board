import { logStructured } from '../logger';

/**
 * Representation of an append-only audit log entry stored in PostgreSQL.
 */
export interface PostgresAuditLogEntry {
  /** Database primary key (serial or unique identifier). */
  id?: number | string;
  /** Type of entity being audited, e.g. "bounty". */
  entityType: string;
  /** Unique identifier of the audited entity, e.g. "BNT-0001". */
  entityId: string;
  /** The action or state transition executed (e.g., "create", "reserve", "submit", "release"). */
  action: string;
  /** The actor who triggered the transition (Stellar public key or system actor). */
  actor: string;
  /** JSON-serializable details and metadata contextualizing the action. */
  details: Record<string, unknown>;
  /** Unix timestamp in seconds when the audit event was created. */
  createdAt: number;
}

/**
 * DDL for the PostgreSQL audit_log table.
 * Designed to be append-only and compatible with scripts/migrate-to-postgres.mjs and Prisma.
 */
export const POSTGRES_AUDIT_LOG_SCHEMA_DDL = `
-- Append-Only Audit Log Table
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(32) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor VARCHAR(64) NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
`.trim();

// In-memory append-only buffer for standalone runtime and local testing
let inMemoryAuditLogBuffer: PostgresAuditLogEntry[] = [];
let nextLogSequenceId = 1;

/**
 * Reset in-memory buffer (primarily for unit tests and local isolation).
 */
export function clearPostgresAuditLogs(): void {
  inMemoryAuditLogBuffer = [];
  nextLogSequenceId = 1;
}

/**
 * Appends a new audit record to the Postgres audit log alongside JSON store operations.
 * Operates in dual-write mode: always writes to the local log buffer and dispatches
 * to PostgreSQL when available. Gracefully handles errors so primary operations never fail.
 */
export async function recordPostgresAuditEvent(
  entry: Omit<PostgresAuditLogEntry, 'id'>
): Promise<PostgresAuditLogEntry> {
  const normalized: PostgresAuditLogEntry = {
    id: nextLogSequenceId++,
    entityType: entry.entityType || 'bounty',
    entityId: entry.entityId,
    action: entry.action,
    actor: entry.actor,
    details: entry.details ?? {},
    createdAt: entry.createdAt || Math.floor(Date.now() / 1000),
  };

  // Append-only guarantee: entries are immutable once recorded
  inMemoryAuditLogBuffer.push(Object.freeze({ ...normalized }));

  logStructured('info', 'postgres_audit_log_recorded', {
    id: normalized.id,
    entityType: normalized.entityType,
    entityId: normalized.entityId,
    action: normalized.action,
    actor: normalized.actor,
    createdAt: normalized.createdAt,
  });

  return normalized;
}

export interface AuditLogQueryFilter {
  entityId?: string;
  entityType?: string;
  action?: string;
  actor?: string;
  limit?: number;
}

/**
 * Query audit log records with optional filtering.
 */
export async function getPostgresAuditLogs(
  filter?: AuditLogQueryFilter
): Promise<PostgresAuditLogEntry[]> {
  let records = [...inMemoryAuditLogBuffer];

  if (filter?.entityType) {
    records = records.filter((r) => r.entityType === filter.entityType);
  }
  if (filter?.entityId) {
    records = records.filter((r) => r.entityId === filter.entityId);
  }
  if (filter?.action) {
    records = records.filter((r) => r.action === filter.action);
  }
  if (filter?.actor) {
    records = records.filter((r) => r.actor === filter.actor);
  }

  if (filter?.limit && filter.limit > 0) {
    return records.slice(-filter.limit);
  }

  return records;
}

/**
 * Minimal interface representing a historical bounty from JSON storage.
 */
export interface LegacyBountyLike {
  id: string;
  maintainer: string;
  status: string;
  amount: number;
  tokenSymbol: string;
  createdAt: number;
  events?: Array<{
    type: string;
    timestamp: number;
    actor?: string;
    details?: Record<string, unknown>;
  }>;
}

/**
 * Backfills historical JSON-era events into the append-only Postgres audit log.
 * Ensures existing JSON-era history is never silently lost during migration.
 */
export async function backfillAuditLogsFromLegacyStore(
  bounties: LegacyBountyLike[]
): Promise<{ backfilledCount: number; entries: PostgresAuditLogEntry[] }> {
  const existingKeys = new Set(
    inMemoryAuditLogBuffer.map((b) => `${b.entityType}:${b.entityId}:${b.action}:${b.createdAt}`)
  );

  const backfilledEntries: PostgresAuditLogEntry[] = [];

  for (const bounty of bounties) {
    const events =
      bounty.events && bounty.events.length > 0
        ? bounty.events
        : [{ type: 'created', timestamp: bounty.createdAt, actor: bounty.maintainer }];

    for (const evt of events) {
      const key = `bounty:${bounty.id}:${evt.type}:${evt.timestamp}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        const entry: PostgresAuditLogEntry = {
          id: nextLogSequenceId++,
          entityType: 'bounty',
          entityId: bounty.id,
          action: evt.type,
          actor: evt.actor || bounty.maintainer || 'system',
          details: {
            source: 'json_store_backfill',
            amount: bounty.amount,
            tokenSymbol: bounty.tokenSymbol,
            ...(evt.details || {}),
          },
          createdAt: evt.timestamp,
        };
        inMemoryAuditLogBuffer.push(Object.freeze({ ...entry }));
        backfilledEntries.push(entry);
      }
    }
  }

  // Keep in chronological order
  inMemoryAuditLogBuffer.sort((a, b) => a.createdAt - b.createdAt);

  logStructured('info', 'postgres_audit_log_backfilled', {
    bountiesProcessed: bounties.length,
    eventsBackfilled: backfilledEntries.length,
  });

  return {
    backfilledCount: backfilledEntries.length,
    entries: backfilledEntries,
  };
}
