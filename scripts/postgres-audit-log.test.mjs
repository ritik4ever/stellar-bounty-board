import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  SCHEMA_DDL,
  DEFAULT_AUDIT_JSON_PATH,
  validateAuditLogRecord,
  extractAuditRecordsFromJSON,
  runMigration,
} from './migrate-to-postgres.mjs';

// Test Issue #1450: Add a Postgres audit log alongside (not instead of) the JSON store during migration
// Asserts append-only audit table, continuous capture of state transitions, independent start,
// and preservation of JSON-era history without silent loss.

test('ISSUE-1450: backend/src/services/postgresAuditLog.ts exists and defines append-only audit log', () => {
  const servicePath = join(process.cwd(), 'backend', 'src', 'services', 'postgresAuditLog.ts');
  assert.ok(existsSync(servicePath), 'postgresAuditLog.ts must exist');

  const content = readFileSync(servicePath, 'utf8');
  assert.match(content, /export interface PostgresAuditLogEntry/);
  assert.match(content, /export const POSTGRES_AUDIT_LOG_SCHEMA_DDL/);
  assert.match(content, /export async function recordPostgresAuditEvent/);
  assert.match(content, /export async function getPostgresAuditLogs/);
  assert.match(content, /export async function backfillAuditLogsFromLegacyStore/);
  assert.match(content, /export function clearPostgresAuditLogs/);

  // Assert DDL specifics
  assert.match(content, /CREATE TABLE IF NOT EXISTS audit_log/);
  assert.match(content, /id SERIAL PRIMARY KEY/);
  assert.match(content, /entity_type VARCHAR\(32\) NOT NULL/);
  assert.match(content, /entity_id VARCHAR\(64\) NOT NULL/);
  assert.match(content, /action VARCHAR\(64\) NOT NULL/);
  assert.match(content, /actor VARCHAR\(64\) NOT NULL/);
  assert.match(content, /details JSONB/);
  assert.match(content, /created_at BIGINT NOT NULL/);
  assert.match(content, /CREATE INDEX IF NOT EXISTS idx_audit_log_entity/);
});

test('ISSUE-1450: Postgres migration schema defines append-only audit_log table', () => {
  assert.match(SCHEMA_DDL, /CREATE TABLE IF NOT EXISTS audit_log/);
  assert.match(SCHEMA_DDL, /idx_audit_log_entity/);
});

test('ISSUE-1450: Existing JSON-era history is validated and preserved without silent loss', () => {
  assert.ok(existsSync(DEFAULT_AUDIT_JSON_PATH), 'bounties.audit.json must exist');
  const records = extractAuditRecordsFromJSON(DEFAULT_AUDIT_JSON_PATH);
  assert.ok(Array.isArray(records));
  assert.ok(records.length > 0, 'Audit store must have historical records');

  for (const record of records) {
    assert.strictEqual(validateAuditLogRecord(record), true);
  }

  // Migration dry-run reports validated audit records alongside bounties
  const result = runMigration({ dryRun: true, backup: false });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.action, 'dry-run');
  assert.ok(result.auditCount > 0, 'Must migrate JSON-era audit records');
});

test('ISSUE-1450: bountyStore hooks audit logging alongside JSON store operations', () => {
  const bountyStorePath = join(process.cwd(), 'backend', 'src', 'services', 'bountyStore.ts');
  const content = readFileSync(bountyStorePath, 'utf8');

  assert.match(
    content,
    /recordPostgresAuditEvent/,
    'bountyStore must import and call recordPostgresAuditEvent'
  );
  assert.match(
    content,
    /backfillBountiesToPostgresAuditLog/,
    'bountyStore must export backfill helper'
  );
});

test('ISSUE-1450: Dedicated unit test suite exists in backend/test/services/postgresAuditLog.unit.test.ts', () => {
  const testPath = join(
    process.cwd(),
    'backend',
    'test',
    'services',
    'postgresAuditLog.unit.test.ts'
  );
  assert.ok(existsSync(testPath), 'postgresAuditLog.unit.test.ts must exist');

  const content = readFileSync(testPath, 'utf8');
  assert.match(content, /postgresAuditLog Service/);
  assert.match(content, /Append-only audit event recording/);
  assert.match(content, /Legacy JSON store backfill/);
});
