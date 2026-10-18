import { describe, it, expect, beforeEach } from 'vitest';
import {
  POSTGRES_AUDIT_LOG_SCHEMA_DDL,
  recordPostgresAuditEvent,
  getPostgresAuditLogs,
  clearPostgresAuditLogs,
  backfillAuditLogsFromLegacyStore,
  type LegacyBountyLike,
} from '../../src/services/postgresAuditLog';

describe('postgresAuditLog Service', () => {
  beforeEach(() => {
    clearPostgresAuditLogs();
  });

  describe('DDL & Schema specification', () => {
    it('defines an append-only audit_log table DDL with correct schema', () => {
      expect(POSTGRES_AUDIT_LOG_SCHEMA_DDL).toContain('CREATE TABLE IF NOT EXISTS audit_log');
      expect(POSTGRES_AUDIT_LOG_SCHEMA_DDL).toContain('id SERIAL PRIMARY KEY');
      expect(POSTGRES_AUDIT_LOG_SCHEMA_DDL).toContain('entity_type VARCHAR(32) NOT NULL');
      expect(POSTGRES_AUDIT_LOG_SCHEMA_DDL).toContain('entity_id VARCHAR(64) NOT NULL');
      expect(POSTGRES_AUDIT_LOG_SCHEMA_DDL).toContain('action VARCHAR(64) NOT NULL');
      expect(POSTGRES_AUDIT_LOG_SCHEMA_DDL).toContain('actor VARCHAR(64) NOT NULL');
      expect(POSTGRES_AUDIT_LOG_SCHEMA_DDL).toContain("details JSONB DEFAULT '{}'::jsonb");
      expect(POSTGRES_AUDIT_LOG_SCHEMA_DDL).toContain('created_at BIGINT NOT NULL');
      expect(POSTGRES_AUDIT_LOG_SCHEMA_DDL).toContain(
        'CREATE INDEX IF NOT EXISTS idx_audit_log_entity'
      );
    });
  });

  describe('Append-only audit event recording', () => {
    it('records state transitions and generates incremental sequence IDs', async () => {
      const entry1 = await recordPostgresAuditEvent({
        entityType: 'bounty',
        entityId: 'BNT-0001',
        action: 'create',
        actor: 'GDZXTESTMAINTAINER1',
        details: { amount: 100, tokenSymbol: 'XLM' },
        createdAt: 1770000000,
      });

      const entry2 = await recordPostgresAuditEvent({
        entityType: 'bounty',
        entityId: 'BNT-0001',
        action: 'reserve',
        actor: 'GDZXTESTCONTRIBUTOR1',
        details: { reservedDuration: 604800 },
        createdAt: 1770003600,
      });

      expect(entry1.id).toBe(1);
      expect(entry2.id).toBe(2);
      expect(entry2.action).toBe('reserve');

      const logs = await getPostgresAuditLogs({ entityId: 'BNT-0001' });
      expect(logs).toHaveLength(2);
      expect(logs[0].action).toBe('create');
      expect(logs[1].action).toBe('reserve');
    });

    it('filters audit logs by action, actor, and limits output', async () => {
      await recordPostgresAuditEvent({
        entityType: 'bounty',
        entityId: 'BNT-0001',
        action: 'create',
        actor: 'GDZXTESTMAINTAINER1',
        details: {},
        createdAt: 100,
      });
      await recordPostgresAuditEvent({
        entityType: 'bounty',
        entityId: 'BNT-0002',
        action: 'create',
        actor: 'GDZXTESTMAINTAINER2',
        details: {},
        createdAt: 200,
      });
      await recordPostgresAuditEvent({
        entityType: 'bounty',
        entityId: 'BNT-0001',
        action: 'release',
        actor: 'GDZXTESTMAINTAINER1',
        details: {},
        createdAt: 300,
      });

      const maintainer1Logs = await getPostgresAuditLogs({ actor: 'GDZXTESTMAINTAINER1' });
      expect(maintainer1Logs).toHaveLength(2);

      const releaseLogs = await getPostgresAuditLogs({ action: 'release' });
      expect(releaseLogs).toHaveLength(1);
      expect(releaseLogs[0].entityId).toBe('BNT-0001');

      const limitedLogs = await getPostgresAuditLogs({ limit: 1 });
      expect(limitedLogs).toHaveLength(1);
      expect(limitedLogs[0].action).toBe('release');
    });
  });

  describe('Legacy JSON store backfill (no lost history)', () => {
    it('backfills historical JSON-era events into the append-only audit log', async () => {
      const legacyBounties: LegacyBountyLike[] = [
        {
          id: 'BNT-0100',
          maintainer: 'GDZXMAINTAINER',
          status: 'released',
          amount: 500,
          tokenSymbol: 'USDC',
          createdAt: 1700000000,
          events: [
            { type: 'created', timestamp: 1700000000, actor: 'GDZXMAINTAINER' },
            { type: 'reserved', timestamp: 1700003600, actor: 'GDZXCONTRIBUTOR' },
            { type: 'submitted', timestamp: 1700007200, actor: 'GDZXCONTRIBUTOR' },
            { type: 'released', timestamp: 1700010800, actor: 'GDZXMAINTAINER' },
          ],
        },
      ];

      const { backfilledCount, entries } = await backfillAuditLogsFromLegacyStore(legacyBounties);
      expect(backfilledCount).toBe(4);
      expect(entries).toHaveLength(4);

      const logs = await getPostgresAuditLogs({ entityId: 'BNT-0100' });
      expect(logs).toHaveLength(4);
      expect(logs.map((l) => l.action)).toEqual(['created', 'reserved', 'submitted', 'released']);
      expect(logs[0].details.source).toBe('json_store_backfill');
    });

    it('is idempotent and prevents duplicate backfill entries', async () => {
      const legacyBounties: LegacyBountyLike[] = [
        {
          id: 'BNT-0101',
          maintainer: 'GDZXMAINTAINER',
          status: 'open',
          amount: 250,
          tokenSymbol: 'XLM',
          createdAt: 1700000000,
        },
      ];

      const firstRun = await backfillAuditLogsFromLegacyStore(legacyBounties);
      expect(firstRun.backfilledCount).toBe(1);

      const secondRun = await backfillAuditLogsFromLegacyStore(legacyBounties);
      expect(secondRun.backfilledCount).toBe(0);

      const logs = await getPostgresAuditLogs({ entityId: 'BNT-0101' });
      expect(logs).toHaveLength(1);
    });
  });
});
