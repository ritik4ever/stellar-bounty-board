import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  SCHEMA_DDL,
  validateBountyRecord,
  parseMigrationArgs,
  runMigration,
} from './migrate-to-postgres.mjs';

// Test Issue #879: [DOCS] Add Postgres migration guide superseding the JSON persistence ADR
// Asserts new ADR discoverability, superseded status, and migration script functionality.

test('ISSUE-879: ADR 0004 exists and documents migration from JSON to Postgres', () => {
  const adrPath = join(process.cwd(), 'docs', 'adr', '0004-postgres-persistence.md');
  assert.ok(existsSync(adrPath), 'docs/adr/0004-postgres-persistence.md must exist');

  const content = readFileSync(adrPath, 'utf8');
  assert.match(content, /0001-json-file-persistence\.md/, 'must reference ADR 0001');
  assert.match(
    content,
    /supersedes:\s*0001-json-file-persistence\.md|Supersedes\s+\[ADR 0001/,
    'must state superseding ADR 0001'
  );
  assert.match(content, /bounties/, 'must include bounties table');
  assert.match(content, /disputes/, 'must include disputes table');
  assert.match(content, /audit_log/, 'must include audit_log table');
  assert.match(content, /--dry-run/, 'must document --dry-run option');
  assert.match(content, /--backup/, 'must document --backup option');
  assert.match(content, /--rollback/, 'must document rollback plan and --rollback option');
});

test('ISSUE-879: ADR 0001 is marked as superseded', () => {
  const adr1Path = join(process.cwd(), 'docs', 'adr', '0001-json-file-persistence.md');
  assert.ok(existsSync(adr1Path), 'docs/adr/0001-json-file-persistence.md must exist');

  const content = readFileSync(adr1Path, 'utf8');
  assert.match(content, /status:\s*superseded/, 'status must be superseded');
  assert.match(content, /0004-postgres-persistence\.md/, 'must link to ADR 0004');
});

test('ISSUE-879: docs/adr/README.md lists ADR 0004 and marks 0001 as Superseded', () => {
  const readmePath = join(process.cwd(), 'docs', 'adr', 'README.md');
  assert.ok(existsSync(readmePath), 'docs/adr/README.md must exist');

  const content = readFileSync(readmePath, 'utf8');
  assert.match(content, /\[0004\]\(0004-postgres-persistence\.md\)/, 'must index ADR 0004');
  assert.match(
    content,
    /\[0001\]\(0001-json-file-persistence\.md\)[\s\S]*?Superseded/,
    'must mark 0001 as Superseded'
  );
});

test('ISSUE-879: scripts/migrate-to-postgres.mjs implements schema, validation, and CLI flags', () => {
  assert.match(SCHEMA_DDL, /CREATE TABLE IF NOT EXISTS bounties/, 'DDL must create bounties table');
  assert.match(SCHEMA_DDL, /CREATE TABLE IF NOT EXISTS disputes/, 'DDL must create disputes table');
  assert.match(
    SCHEMA_DDL,
    /CREATE TABLE IF NOT EXISTS audit_log/,
    'DDL must create audit_log table'
  );

  const validBounty = {
    id: 'B-1',
    repo: 'stellar/board',
    issueNumber: 879,
    title: 'Migrate to Postgres',
    amount: 100,
  };
  assert.strictEqual(validateBountyRecord(validBounty), true);

  assert.throws(() => validateBountyRecord({ id: '' }), /Invalid bounty/);

  const args = parseMigrationArgs(['--dry-run', '--backup']);
  assert.strictEqual(args.dryRun, true);
  assert.strictEqual(args.backup, true);
  assert.strictEqual(args.rollback, false);

  const dryResult = runMigration({ dryRun: true, backup: false });
  assert.strictEqual(dryResult.success, true);
  assert.strictEqual(dryResult.action, 'dry-run');

  const rollbackResult = runMigration({ rollback: true });
  assert.strictEqual(rollbackResult.success, true);
  assert.strictEqual(rollbackResult.action, 'rollback');
});
