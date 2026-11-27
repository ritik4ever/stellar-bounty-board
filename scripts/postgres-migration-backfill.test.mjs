import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BOUNTY_COLUMNS,
  DEFAULT_AUDIT_JSON_PATH,
  DEFAULT_JSON_PATH,
  buildAuditInsert,
  buildBountyUpsert,
  buildMigrationPlan,
  executeMigration,
  normalizeBountyRecord,
  runMigration,
} from './migrate-to-postgres.mjs';

// Issue #1169: reconcile the SQLite/Drizzle and Postgres persistence plans, backfill
// existing JSON data, and rehearse the migration against a data copy before cutover.

function createFakeClient(options = {}) {
  const bounties = new Map();
  const audits = [];
  const state = { transactions: [], rolledBack: false };

  return {
    bounties,
    audits,
    state,
    async query(text, values = []) {
      const sql = text.trim();

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        state.transactions.push(sql);
        if (sql === 'ROLLBACK') state.rolledBack = true;
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('INSERT INTO bounties')) {
        const row = Object.fromEntries(
          BOUNTY_COLUMNS.map((column, index) => [column, values[index]])
        );
        for (const column of ['labels', 'events', 'payload']) {
          row[column] = JSON.parse(row[column]);
        }
        bounties.set(row.id, { payload: row.payload });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO audit_log')) {
        const key = `${values[0]}|${values[1]}|${values[2]}|${values[3]}|${values[5]}`;
        if (!audits.some((entry) => entry.key === key)) audits.push({ key });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('SELECT id, payload FROM bounties')) {
        const rows = values[0]
          .filter((id) => bounties.has(id))
          .map((id) => ({
            id,
            payload:
              id === options.corruptId
                ? { ...bounties.get(id).payload, title: 'corrupted' }
                : bounties.get(id).payload,
          }));
        return { rows, rowCount: rows.length };
      }
      if (
        sql.startsWith('SELECT entity_type, entity_id, action, actor, created_at FROM audit_log')
      ) {
        const ids = new Set(values[0]);
        const rows = audits
          .map((entry) => entry.key.split('|'))
          .filter(([, entityId]) => ids.has(entityId))
          .map(([entity_type, entity_id, action, actor, created_at]) => ({
            entity_type,
            entity_id,
            action,
            actor,
            created_at,
          }));
        return { rows, rowCount: rows.length };
      }
      throw new Error(`Unexpected query in fake client: ${sql.slice(0, 80)}`);
    },
    async end() {},
  };
}

function copyFixtures() {
  const directory = mkdtempSync(join(tmpdir(), 'bounty-migration-'));
  const bountyPath = join(directory, 'bounties.prod-copy.json');
  const auditPath = join(directory, 'bounties.audit.prod-copy.json');
  copyFileSync(DEFAULT_JSON_PATH, bountyPath);
  copyFileSync(DEFAULT_AUDIT_JSON_PATH, auditPath);
  return { directory, bountyPath, auditPath };
}

test('ISSUE-1169: wave backlogs and ADR name PostgreSQL as the only migration target', () => {
  const wave4 = readFileSync(join(process.cwd(), 'docs', 'wave-4.md'), 'utf8');
  const wave5 = readFileSync(join(process.cwd(), 'docs', 'wave-5.md'), 'utf8');
  const wave6 = readFileSync(join(process.cwd(), 'docs', 'wave-6.md'), 'utf8');
  const adr = readFileSync(
    join(process.cwd(), 'docs', 'adr', '0004-postgres-persistence.md'),
    'utf8'
  );

  // The retired plan must no longer be presented as live backlog work.
  assert.doesNotMatch(wave4, /SQLite via Drizzle ORM\s+\|/, 'wave-4 item 33 must be amended');
  assert.doesNotMatch(wave5, /SQLite via Drizzle ORM\s+\|/, 'wave-5 item 17 must be amended');
  assert.match(wave4, /PostgreSQL/, 'wave-4 must name the chosen target');
  assert.match(wave4, /0004-postgres-persistence\.md/, 'wave-4 must link ADR 0004');
  assert.match(wave5, /ADR 0004|0004-postgres-persistence\.md/, 'wave-5 must link ADR 0004');
  assert.match(
    wave6,
    /Single migration target \(Issue #1169\)/,
    'wave-6 must record reconciliation'
  );
  assert.match(wave6, /postgres-migration\.md/, 'wave-6 must link the migration runbook');
  assert.match(adr, /single\*\* target/i, 'ADR must state a single target');
  assert.match(adr, /postgres-migration\.md/, 'ADR must link the rehearsal runbook');
});

test('ISSUE-1169: the runbook documents the pre-cutover dry run against a data copy', () => {
  const runbookPath = join(process.cwd(), 'docs', 'postgres-migration.md');
  assert.ok(existsSync(runbookPath), 'docs/postgres-migration.md must exist');
  const runbook = readFileSync(runbookPath, 'utf8');

  assert.match(runbook, /--dry-run/, 'must document dry-run mode');
  assert.match(runbook, /--source \/tmp\/bounty-migration/, 'must read from a copied store');
  assert.match(runbook, /cp backend\/data\/bounties\.json/, 'must copy production data first');
  assert.match(runbook, /--execute --backup/, 'must document execution with a backup');
  assert.match(runbook, /\[dry-run\] Validation passed/, 'must include recorded dry-run evidence');
  assert.match(runbook, /audit_log/, 'must cover audit history preservation');
  assert.match(runbook, /rollback/i, 'must cover rollback');
});

test('ISSUE-1169: dry-run against a copy is read-only and reports what would migrate', () => {
  const { directory, bountyPath, auditPath } = copyFixtures();
  const before = readFileSync(bountyPath, 'utf8');
  const reportPath = join(directory, 'report.json');

  const result = runMigration({
    jsonPath: bountyPath,
    auditJsonPath: auditPath,
    dryRun: true,
    quiet: true,
    reportPath,
  });

  assert.equal(result.success, true);
  assert.equal(result.action, 'dry-run');
  assert.equal(result.count, 2);
  assert.equal(result.auditCount, 90);
  assert.equal(readFileSync(bountyPath, 'utf8'), before, 'source copy must not be modified');

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.counts.bounties, 2);
  assert.equal(report.counts.auditRecords, 90);
  assert.equal(report.validation.ok, true);
  assert.deepEqual(report.statements.tables, ['bounties', 'disputes', 'audit_log']);
  assert.match(report.source.sha256, /^[a-f0-9]{64}$/);
});

test('ISSUE-1169: records are normalized into relational rows without losing fields', () => {
  const plan = buildMigrationPlan({
    jsonPath: DEFAULT_JSON_PATH,
    auditJsonPath: DEFAULT_AUDIT_JSON_PATH,
  });
  const source = JSON.parse(readFileSync(DEFAULT_JSON_PATH, 'utf8'));
  const row = plan.bountyRows.find((candidate) => candidate.id === 'BNT-0002');
  const original = source.find((candidate) => candidate.id === 'BNT-0002');

  assert.ok(row, 'BNT-0002 must be in the plan');
  assert.equal(row.repo, original.repo);
  assert.equal(row.issue_number, original.issueNumber);
  assert.equal(row.token_address, original.tokenAddress);
  assert.equal(row.reservation_timeout_seconds, original.reservationTimeoutSeconds);
  assert.equal(row.amount, String(original.amount));
  assert.deepEqual(row.labels, original.labels);
  assert.deepEqual(row.events, original.events);
  assert.deepEqual(row.payload, original, 'full source record must be preserved');

  const upsert = buildBountyUpsert(row);
  assert.match(upsert.text, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.match(upsert.text, /updated_at = CURRENT_TIMESTAMP/);
  assert.equal(upsert.values.length, BOUNTY_COLUMNS.length);
  // jsonb values are passed serialized, never interpolated into SQL.
  assert.equal(upsert.values[BOUNTY_COLUMNS.indexOf('labels')], JSON.stringify(original.labels));
});

test('ISSUE-1169: malformed records fail loudly with the record index', () => {
  assert.throws(
    () =>
      normalizeBountyRecord({ id: 'BNT-X', repo: 'a/b', issueNumber: 1, title: 't', amount: 1 }),
    /missing tokenSymbol/,
    'NOT NULL columns must be validated'
  );

  const { row, warnings } = normalizeBountyRecord({
    id: 'BNT-X',
    repo: 'a/b',
    issueNumber: 1,
    title: 't',
    amount: 1,
    tokenSymbol: 'XLM',
    maintainer: 'GABC',
    status: 'mystery',
    createdAt: 1,
  });
  assert.equal(row.status, 'mystery', 'unknown statuses migrate as-is');
  assert.match(warnings.join('\n'), /not a known app status/);
  assert.match(warnings.join('\n'), /missing deadlineAt/);

  const { directory } = copyFixtures();
  const duplicatePath = join(directory, 'duplicates.json');
  const record = {
    id: 'BNT-DUP',
    repo: 'a/b',
    issueNumber: 1,
    title: 't',
    amount: 1,
    tokenSymbol: 'XLM',
    maintainer: 'GABC',
    createdAt: 1,
    deadlineAt: 2,
  };
  writeFileSync(duplicatePath, JSON.stringify([record, record]));
  assert.throws(
    () =>
      buildMigrationPlan({
        jsonPath: duplicatePath,
        auditJsonPath: join(directory, 'missing-audit.json'),
      }),
    /Duplicate bounty id "BNT-DUP"/
  );
});

test('ISSUE-1169: audit inserts are idempotent for re-runs', () => {
  const record = {
    bountyId: 'BNT-0001',
    transition: 'expire',
    actor: 'system',
    timestamp: 1777223009,
    metadata: { reason: 'deadline_passed' },
  };
  const first = buildAuditInsert(record);
  const second = buildAuditInsert(record);

  assert.match(first.text, /WHERE NOT EXISTS/);
  assert.deepEqual(first.values, second.values);
  assert.equal(first.values[1], 'BNT-0001');
  assert.equal(first.values[2], 'expire');
});

test('ISSUE-1169: executeMigration backfills rows and audit history idempotently', async () => {
  const plan = buildMigrationPlan({
    jsonPath: DEFAULT_JSON_PATH,
    auditJsonPath: DEFAULT_AUDIT_JSON_PATH,
  });
  const client = createFakeClient();

  const first = await executeMigration(plan, { client, quiet: true });
  assert.equal(first.success, true);
  assert.equal(first.action, 'migrated');
  assert.equal(first.count, 2);
  assert.equal(first.auditCount, 90);
  assert.equal(client.bounties.size, 2);
  assert.equal(client.audits.length, 90);
  assert.deepEqual(first.verification.missing, []);
  assert.deepEqual(first.verification.mismatched, []);
  assert.deepEqual(first.verification.missingAudit, []);

  // A second run must not duplicate rows or audit events.
  const second = await executeMigration(plan, { client, quiet: true });
  assert.equal(second.success, true);
  assert.equal(client.bounties.size, 2);
  assert.equal(client.audits.length, 90);
  assert.deepEqual(second.verification.missingAudit, []);
});

test('ISSUE-1169: executeMigration rolls back when verification detects a mismatch', async () => {
  const plan = buildMigrationPlan({
    jsonPath: DEFAULT_JSON_PATH,
    auditJsonPath: DEFAULT_AUDIT_JSON_PATH,
  });
  const client = createFakeClient({ corruptId: 'BNT-0002' });

  await assert.rejects(
    () => executeMigration(plan, { client, quiet: true }),
    /Verification failed: 0 missing row\(s\), 1 payload mismatch\(es\)/
  );
  assert.equal(client.state.rolledBack, true, 'a failed run must roll back the transaction');
});

test('ISSUE-1169: the CLI dry-run writes a report and leaves the copy untouched', () => {
  const { directory, bountyPath, auditPath } = copyFixtures();
  const reportPath = join(directory, 'cli-report.json');
  const before = readFileSync(bountyPath, 'utf8');

  const output = execFileSync(
    process.execPath,
    [
      join(process.cwd(), 'scripts', 'migrate-to-postgres.mjs'),
      '--dry-run',
      '--source',
      bountyPath,
      '--audit-source',
      auditPath,
      '--report',
      reportPath,
    ],
    { cwd: process.cwd(), encoding: 'utf8' }
  );

  assert.match(output, /\[dry-run\] Validation passed/);
  assert.equal(readFileSync(bountyPath, 'utf8'), before);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.counts.bounties, 2);
  assert.equal(report.counts.auditRecords, 90);
});
