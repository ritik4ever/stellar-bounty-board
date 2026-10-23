#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/**
 * Migration CLI: backfill the PostgreSQL store from the JSON file store.
 *
 * This script is the cutover tool referenced by ADR 0004. PostgreSQL is the
 * single chosen target (SQLite/Drizzle is not part of the plan).
 *
 * Usage:
 *   node scripts/migrate-to-postgres.mjs [options]
 *
 * Options:
 *   --dry-run               Validate records and print the migration plan. Read-only.
 *                           This is the default mode when --execute is omitted.
 *   --execute               Apply the schema DDL and backfill rows. Requires a database URL.
 *   --source <path>         JSON bounty store to read (default: backend/data/bounties.json).
 *                           Point this at a copy of production data for the rehearsal run.
 *   --audit-source <path>   JSON audit store to read (default: backend/data/bounties.audit.json).
 *   --database-url <url>    PostgreSQL connection string (default: DATABASE_URL).
 *   --backup                Copy the source JSON store before executing writes.
 *   --report <path>         Write a machine-readable JSON report to this path.
 *   --rollback              Print the reviewed inverse-DDL rollback plan (no database writes).
 *   --help                  Show this usage guide.
 *
 * Exit codes: 0 success/dry-run, 1 validation or migration failure.
 */

export const DEFAULT_JSON_PATH = join(process.cwd(), 'backend', 'data', 'bounties.json');
export const DEFAULT_AUDIT_JSON_PATH = join(
  process.cwd(),
  'backend',
  'data',
  'bounties.audit.json'
);

/**
 * Columns written for every bounty. `updated_at` is maintained by the database.
 * The full source record is also stored in `payload` so fields that are not yet
 * modelled as columns survive the cutover losslessly.
 */
export const BOUNTY_COLUMNS = [
  'id',
  'repo',
  'issue_number',
  'title',
  'summary',
  'amount',
  'token_symbol',
  'token_address',
  'maintainer',
  'contributor',
  'status',
  'created_at',
  'deadline_at',
  'reserved_at',
  'submitted_at',
  'released_at',
  'refunded_at',
  'released_tx_hash',
  'refunded_tx_hash',
  'escrow_status',
  'submission_url',
  'labels',
  'events',
  'notes',
  'version',
  'reservation_timeout_seconds',
  'payload',
];

const JSON_COLUMNS = new Set(['labels', 'events', 'payload']);

const KNOWN_STATUSES = new Set([
  'open',
  'reserved',
  'submitted',
  'released',
  'refunded',
  'expired',
  'disputed',
]);

export const SCHEMA_DDL = `
-- Core Bounties Table
CREATE TABLE IF NOT EXISTS bounties (
  id VARCHAR(64) PRIMARY KEY,
  repo VARCHAR(255) NOT NULL,
  issue_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  amount NUMERIC(20, 7) NOT NULL,
  token_symbol VARCHAR(16) NOT NULL,
  token_address VARCHAR(128),
  maintainer VARCHAR(64) NOT NULL,
  contributor VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL,
  deadline_at BIGINT NOT NULL,
  reserved_at BIGINT,
  submitted_at BIGINT,
  released_at BIGINT,
  refunded_at BIGINT,
  released_tx_hash VARCHAR(128),
  refunded_tx_hash VARCHAR(128),
  escrow_status VARCHAR(32),
  submission_url TEXT,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  reservation_timeout_seconds INTEGER,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bounties_repo ON bounties(repo);
CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
CREATE INDEX IF NOT EXISTS idx_bounties_maintainer ON bounties(maintainer);
CREATE INDEX IF NOT EXISTS idx_bounties_contributor ON bounties(contributor);

-- Disputes Table
CREATE TABLE IF NOT EXISTS disputes (
  id VARCHAR(64) PRIMARY KEY,
  bounty_id VARCHAR(64) NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  initiator VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'opened',
  resolution TEXT,
  arbiter VARCHAR(64),
  created_at BIGINT NOT NULL,
  resolved_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_disputes_bounty_id ON disputes(bounty_id);

-- Audit Log Table
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
`;

/**
 * Basic shape validation. Kept intentionally permissive for backwards
 * compatibility; normalizeBountyRecord() enforces every NOT NULL column.
 */
export function validateBountyRecord(bounty) {
  if (!bounty || typeof bounty !== 'object' || Array.isArray(bounty)) {
    throw new Error(`Invalid bounty: expected an object`);
  }
  if (!bounty.id || typeof bounty.id !== 'string') {
    throw new Error(`Invalid bounty: missing id`);
  }
  if (!bounty.repo || typeof bounty.repo !== 'string') {
    throw new Error(`Invalid bounty #${bounty.id}: missing repo`);
  }
  if (typeof bounty.issueNumber !== 'number') {
    throw new Error(`Invalid bounty #${bounty.id}: missing issueNumber`);
  }
  if (!bounty.title || typeof bounty.title !== 'string') {
    throw new Error(`Invalid bounty #${bounty.id}: missing title`);
  }
  if (typeof bounty.amount !== 'number' || bounty.amount <= 0) {
    throw new Error(`Invalid bounty #${bounty.id}: amount must be positive`);
  }
  return true;
}

export function validateAuditLogRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Invalid audit record: must be an object');
  }
  const entityId = record.bountyId || record.entityId;
  if (!entityId || typeof entityId !== 'string') {
    throw new Error('Invalid audit record: missing bountyId / entityId');
  }
  const action = record.transition || record.action;
  if (!action || typeof action !== 'string') {
    throw new Error('Invalid audit record: missing transition / action');
  }
  if (!record.actor || typeof record.actor !== 'string') {
    throw new Error('Invalid audit record: missing actor');
  }
  const ts = record.timestamp ?? record.createdAt ?? record.metadata?.deadlineAt;
  if (ts !== undefined && (typeof ts !== 'number' || !Number.isFinite(ts))) {
    throw new Error('Invalid audit record: timestamp must be numeric');
  }
  return true;
}

function requireString(value, field, id) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid bounty #${id}: missing ${field}`);
  }
  return value;
}

function requireTimestamp(value, field, id) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid bounty #${id}: ${field} must be a finite unix timestamp`);
  }
  return Math.trunc(value);
}

function optionalTimestamp(value, field, id) {
  if (value === undefined || value === null) return null;
  return requireTimestamp(value, field, id);
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function normalizeLabels(labels, id, warnings) {
  if (labels === undefined || labels === null) return [];
  if (!Array.isArray(labels)) {
    throw new Error(`Invalid bounty #${id}: labels must be an array`);
  }
  return labels.map((label) => {
    if (typeof label === 'string') return label;
    if (label && typeof label === 'object' && typeof label.name === 'string') {
      warnings.push(`Bounty #${id}: flattened GitHub label object "${label.name}" to its name.`);
      return label.name;
    }
    warnings.push(`Bounty #${id}: dropped non-string label ${JSON.stringify(label)}.`);
    return String(label);
  });
}

/**
 * Map a JSON-store record onto the PostgreSQL column set.
 * Returns { row, warnings }, where row.payload is the untouched source record.
 */
export function normalizeBountyRecord(bounty) {
  validateBountyRecord(bounty);

  const id = bounty.id;
  const warnings = [];
  const tokenSymbol = requireString(bounty.tokenSymbol, 'tokenSymbol', id);
  const maintainer = requireString(bounty.maintainer, 'maintainer', id);
  const createdAt = requireTimestamp(bounty.createdAt, 'createdAt', id);
  let deadlineAt = bounty.deadlineAt;
  if (deadlineAt === undefined || deadlineAt === null) {
    deadlineAt = createdAt;
    warnings.push(`Bounty #${id}: missing deadlineAt, defaulted to createdAt.`);
  }
  deadlineAt = requireTimestamp(deadlineAt, 'deadlineAt', id);

  const status =
    typeof bounty.status === 'string' && bounty.status.trim() !== '' ? bounty.status : 'open';
  if (!KNOWN_STATUSES.has(status)) {
    warnings.push(`Bounty #${id}: status "${status}" is not a known app status; migrated as-is.`);
  }

  return {
    row: {
      id,
      repo: bounty.repo,
      issue_number: Math.trunc(bounty.issueNumber),
      title: bounty.title,
      summary: typeof bounty.summary === 'string' ? bounty.summary : '',
      amount: String(bounty.amount),
      token_symbol: tokenSymbol,
      token_address: optionalString(bounty.tokenAddress),
      maintainer,
      contributor: optionalString(bounty.contributor),
      status,
      created_at: createdAt,
      deadline_at: deadlineAt,
      reserved_at: optionalTimestamp(bounty.reservedAt, 'reservedAt', id),
      submitted_at: optionalTimestamp(bounty.submittedAt, 'submittedAt', id),
      released_at: optionalTimestamp(bounty.releasedAt, 'releasedAt', id),
      refunded_at: optionalTimestamp(bounty.refundedAt, 'refundedAt', id),
      released_tx_hash: optionalString(bounty.releasedTxHash),
      refunded_tx_hash: optionalString(bounty.refundedTxHash),
      escrow_status: optionalString(bounty.escrowStatus),
      submission_url: optionalString(bounty.submissionUrl),
      labels: normalizeLabels(bounty.labels, id, warnings),
      events: Array.isArray(bounty.events) ? bounty.events : [],
      notes: optionalString(bounty.notes),
      version:
        typeof bounty.version === 'number' && Number.isFinite(bounty.version)
          ? Math.trunc(bounty.version)
          : 1,
      reservation_timeout_seconds:
        typeof bounty.reservationTimeoutSeconds === 'number'
          ? Math.trunc(bounty.reservationTimeoutSeconds)
          : null,
      payload: bounty,
    },
    warnings,
  };
}

export function normalizeAuditRecord(record) {
  validateAuditLogRecord(record);
  const entityId = record.bountyId || record.entityId;
  const action = record.transition || record.action;
  const rawTimestamp = record.timestamp ?? record.createdAt ?? record.metadata?.deadlineAt;
  if (typeof rawTimestamp !== 'number' || !Number.isFinite(rawTimestamp)) {
    throw new Error(
      `Invalid audit record for #${entityId}: timestamp, createdAt or metadata.deadlineAt must be numeric`
    );
  }
  return {
    entityType: 'bounty',
    entityId,
    action,
    actor: record.actor,
    details: {
      source: 'json_store_backfill',
      ...(record.fromStatus ? { fromStatus: record.fromStatus } : {}),
      ...(record.toStatus ? { toStatus: record.toStatus } : {}),
      ...(record.metadata && typeof record.metadata === 'object' ? record.metadata : {}),
    },
    createdAt: Math.trunc(rawTimestamp),
  };
}

/** Parameterized, idempotent upsert. Re-running the migration updates rows in place. */
export function buildBountyUpsert(row) {
  const values = BOUNTY_COLUMNS.map((column) => {
    const value = row[column];
    if (JSON_COLUMNS.has(column)) {
      if (value === undefined) return JSON.stringify(column === 'payload' ? {} : []);
      return JSON.stringify(value);
    }
    return value === undefined ? null : value;
  });
  const placeholders = BOUNTY_COLUMNS.map((_, index) => `$${index + 1}`);
  const updates = BOUNTY_COLUMNS.filter((column) => column !== 'id')
    .map((column) => `${column} = EXCLUDED.${column}`)
    .concat('updated_at = CURRENT_TIMESTAMP')
    .join(',\n    ');

  return {
    text: `INSERT INTO bounties (\n  ${BOUNTY_COLUMNS.join(', ')}\n) VALUES (${placeholders.join(
      ', '
    )})\nON CONFLICT (id) DO UPDATE SET\n    ${updates}`,
    values,
  };
}

/**
 * Parameterized audit insert. The NOT EXISTS guard makes backfill re-runs
 * idempotent without requiring a schema change on the append-only table.
 */
export function buildAuditInsert(record) {
  const audit = normalizeAuditRecord(record);
  return {
    text: `INSERT INTO audit_log (entity_type, entity_id, action, actor, details, created_at)
SELECT $1::varchar(32), $2::varchar(64), $3::varchar(64), $4::varchar(64), $5::jsonb, $6::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM audit_log
  WHERE entity_type = $1 AND entity_id = $2 AND action = $3 AND actor = $4 AND created_at = $6
)`,
    values: [
      audit.entityType,
      audit.entityId,
      audit.action,
      audit.actor,
      JSON.stringify(audit.details),
      audit.createdAt,
    ],
  };
}

function readJsonArray(path, label) {
  if (!existsSync(path)) {
    return { records: [], warnings: [`${label} not found at ${path}; treated as empty.`] };
  }
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) {
    return { records: [], warnings: [`${label} at ${path} is empty; treated as empty.`] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse ${label} at ${path}: ${error.message}`);
  }
  const records = Array.isArray(parsed) ? parsed : parsed?.bounties;
  if (!Array.isArray(records)) {
    throw new Error(
      `${label} at ${path} must be a JSON array or an object with a "bounties" array`
    );
  }
  return { records, warnings: [] };
}

export function extractAuditRecordsFromJSON(auditPath = DEFAULT_AUDIT_JSON_PATH) {
  return readJsonArray(auditPath, 'audit store').records;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function countBy(items, key) {
  return items.reduce((totals, item) => {
    const value = item[key] ?? 'unknown';
    totals[value] = (totals[value] || 0) + 1;
    return totals;
  }, {});
}

/**
 * Build the complete, read-only migration plan. No database connection is made.
 */
export function buildMigrationPlan(options = {}) {
  const jsonPath = resolve(options.jsonPath || DEFAULT_JSON_PATH);
  const auditPath = resolve(options.auditJsonPath || DEFAULT_AUDIT_JSON_PATH);
  const warnings = [];

  const bountySource = readJsonArray(jsonPath, 'bounty store');
  warnings.push(...bountySource.warnings);
  const auditSource = readJsonArray(auditPath, 'audit store');
  warnings.push(...auditSource.warnings);

  const seenIds = new Set();
  const bountyRows = [];
  const bountyStatements = [];
  bountySource.records.forEach((record, index) => {
    let normalized;
    try {
      normalized = normalizeBountyRecord(record);
    } catch (error) {
      throw new Error(`Bounty record at index ${index}: ${error.message}`);
    }
    if (seenIds.has(normalized.row.id)) {
      throw new Error(`Duplicate bounty id "${normalized.row.id}" in ${jsonPath}`);
    }
    seenIds.add(normalized.row.id);
    warnings.push(...normalized.warnings);
    bountyRows.push(normalized.row);
    bountyStatements.push(buildBountyUpsert(normalized.row));
  });

  const auditStatements = [];
  auditSource.records.forEach((record, index) => {
    try {
      auditStatements.push(buildAuditInsert(record));
    } catch (error) {
      throw new Error(`Audit record at index ${index}: ${error.message}`);
    }
  });

  const auditEntityIds = new Set(auditStatements.map((statement) => statement.values[1]));
  const orphanedAuditEntityIds = [...auditEntityIds].filter((id) => !seenIds.has(id));
  if (orphanedAuditEntityIds.length > 0) {
    warnings.push(
      `Audit store references ${orphanedAuditEntityIds.length} entity id(s) with no matching bounty: ${orphanedAuditEntityIds
        .slice(0, 5)
        .join(
          ', '
        )}${orphanedAuditEntityIds.length > 5 ? '…' : ''}. They are preserved in audit_log.`
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.execute ? 'execute' : 'dry-run',
    source: {
      path: jsonPath,
      exists: existsSync(jsonPath),
      sha256: existsSync(jsonPath) ? sha256(jsonPath) : null,
      bytes: existsSync(jsonPath) ? readFileSync(jsonPath).length : 0,
    },
    auditSource: {
      path: auditPath,
      exists: existsSync(auditPath),
      sha256: existsSync(auditPath) ? sha256(auditPath) : null,
    },
    counts: {
      bounties: bountyRows.length,
      auditRecords: auditStatements.length,
      orphanedAuditEntityIds: orphanedAuditEntityIds.length,
    },
    statuses: countBy(bountyRows, 'status'),
    auditActions: countBy(
      auditStatements.map((statement) => ({ action: statement.values[2] })),
      'action'
    ),
    bountyIds: bountyRows.map((row) => row.id),
    statements: {
      tables: ['bounties', 'disputes', 'audit_log'],
      bountyUpserts: bountyStatements.length,
      auditInserts: auditStatements.length,
    },
    warnings,
    validation: { ok: true, errors: [] },
  };

  return { jsonPath, auditPath, bountyRows, bountyStatements, auditStatements, report };
}

/**
 * Synchronous plan / dry-run entry point (also used by the CLI).
 * This never connects to PostgreSQL. Use executeMigration() to write.
 */
export function runMigration(options = {}) {
  const shouldRollback = options.rollback ?? false;
  const dryRun = options.dryRun ?? !options.execute;
  const log = options.quiet ? () => {} : console.log;

  if (shouldRollback) {
    log('=== Stellar Bounty Board: Postgres Migration Runner ===');
    log('[rollback] Reviewed rollback plan (not executed by this script):');
    log('  BEGIN;');
    log('  DROP TABLE IF EXISTS audit_log;');
    log('  DROP TABLE IF EXISTS disputes;');
    log('  DROP TABLE IF EXISTS bounties;');
    log('  COMMIT;');
    log('[rollback] JSON remains authoritative until the cutover completes.');
    log('[rollback] A pre-migration copy is written by --execute --backup.');
    return { success: true, action: 'rollback' };
  }

  const plan = buildMigrationPlan(options);
  const { report } = plan;

  log('=== Stellar Bounty Board: Postgres Migration Runner ===');
  log(`[source] ${report.source.path}`);
  log(`[source] sha256 ${report.source.sha256 ?? '(missing)'}`);
  log(
    `[source] ${report.counts.bounties} bounty records, ${report.counts.auditRecords} audit records`
  );
  log(`[status] ${JSON.stringify(report.statuses)}`);
  if (report.warnings.length > 0) {
    for (const warning of report.warnings) log(`[warning] ${warning}`);
  }
  log('[plan] Schema DDL ready (bounties, disputes, audit_log).');
  log(`[plan] ${report.statements.bountyUpserts} idempotent bounty upserts`);
  log(`[plan] ${report.statements.auditInserts} deduplicated audit inserts`);

  if (options.reportPath) {
    writeReport(options.reportPath, report);
    log(`[report] Wrote migration report to ${resolve(options.reportPath)}`);
  }

  if (dryRun) {
    log('[dry-run] Validation passed. No database connection was made and no data changed.');
    return {
      success: true,
      action: 'dry-run',
      count: report.counts.bounties,
      auditCount: report.counts.auditRecords,
      plan,
      report,
    };
  }

  return {
    success: true,
    action: 'ready',
    count: report.counts.bounties,
    auditCount: report.counts.auditRecords,
    plan,
    report,
  };
}

export function writeReport(reportPath, report) {
  const target = resolve(reportPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  return target;
}

async function createPgClient(connectionString) {
  let pg;
  try {
    pg = await import('pg');
  } catch {
    throw new Error(
      "The 'pg' package is required to backfill PostgreSQL. Run 'npm install' at the repository root."
    );
  }
  const Client = pg.default?.Client ?? pg.Client;
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

/**
 * Compare the database against the plan: every source row must exist with an
 * identical payload, and every audit event must be present exactly once.
 */
export async function verifyMigration(db, plan) {
  const ids = plan.bountyRows.map((row) => row.id);
  const idSet = new Set(ids);
  const bountyResult = await db.query(
    'SELECT id, payload FROM bounties WHERE id = ANY($1::text[])',
    [ids]
  );
  const found = new Map(bountyResult.rows.map((row) => [row.id, row.payload]));
  const missing = ids.filter((id) => !found.has(id));
  const mismatched = plan.bountyRows
    .filter((row) => found.has(row.id) && !isDeepStrictEqual(found.get(row.id), row.payload))
    .map((row) => row.id);

  const auditResult = await db.query(
    'SELECT entity_type, entity_id, action, actor, created_at FROM audit_log WHERE entity_id = ANY($1::text[])',
    [ids]
  );
  const auditKeys = new Set(
    auditResult.rows.map(
      (row) =>
        `${row.entity_type}|${row.entity_id}|${row.action}|${row.actor}|${String(row.created_at)}`
    )
  );
  const missingAudit = plan.auditStatements
    .map((statement) => statement.values)
    .filter(
      (values) =>
        idSet.has(values[1]) &&
        !auditKeys.has(`${values[0]}|${values[1]}|${values[2]}|${values[3]}|${String(values[5])}`)
    )
    .map((values) => `${values[1]}:${values[2]}@${values[5]}`);

  return {
    bountiesInDatabase: bountyResult.rowCount,
    auditRowsInDatabase: auditResult.rowCount,
    missing,
    mismatched,
    missingAudit,
  };
}

/**
 * Apply the schema and backfill all rows inside a single transaction.
 * Accepts an injected `client` (anything with query/end) for tests.
 */
export async function executeMigration(plan, options = {}) {
  if (!plan || !Array.isArray(plan.bountyStatements) || !Array.isArray(plan.auditStatements)) {
    throw new TypeError('executeMigration() requires a plan built by buildMigrationPlan()');
  }
  const ownsClient = !options.client;
  const connectionString = options.databaseUrl || process.env.DATABASE_URL;
  if (ownsClient && !connectionString) {
    throw new Error('A PostgreSQL connection string is required (--database-url or DATABASE_URL)');
  }

  const db = options.client ?? (await createPgClient(connectionString));
  const log = options.quiet ? () => {} : console.log;
  log(`[execute] Executing backfill plan for ${plan.jsonPath}`);
  try {
    await db.query('BEGIN');
    await db.query(SCHEMA_DDL);
    log('[execute] Applied idempotent schema DDL.');

    for (const statement of plan.bountyStatements) {
      await db.query(statement.text, statement.values);
    }
    log(`[execute] Backfilled ${plan.bountyStatements.length} bounty rows.`);

    for (const statement of plan.auditStatements) {
      await db.query(statement.text, statement.values);
    }
    log(`[execute] Backfilled ${plan.auditStatements.length} audit records.`);

    const verification = await verifyMigration(db, plan);
    if (verification.missing.length || verification.mismatched.length) {
      throw new Error(
        `Verification failed: ${verification.missing.length} missing row(s), ` +
          `${verification.mismatched.length} payload mismatch(es)`
      );
    }
    if (verification.missingAudit.length) {
      throw new Error(
        `Verification failed: ${verification.missingAudit.length} audit event(s) missing`
      );
    }

    await db.query('COMMIT');
    log('[execute] Verification passed. Transaction committed.');
    return {
      success: true,
      action: 'migrated',
      count: plan.bountyStatements.length,
      auditCount: plan.auditStatements.length,
      verification,
    };
  } catch (error) {
    try {
      await db.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    if (ownsClient) await db.end();
  }
}

export function parseMigrationArgs(args) {
  const options = {
    dryRun: false,
    execute: false,
    backup: false,
    rollback: false,
    help: false,
    source: null,
    auditSource: null,
    reportPath: null,
    databaseUrl: null,
  };
  const valueFlags = {
    '--source': 'source',
    '--audit-source': 'auditSource',
    '--report': 'reportPath',
    '--database-url': 'databaseUrl',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--execute') options.execute = true;
    else if (arg === '--backup') options.backup = true;
    else if (arg === '--rollback') options.rollback = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (valueFlags[arg]) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      options[valueFlags[arg]] = value;
      index += 1;
    } else if (arg.startsWith('--') && arg.includes('=')) {
      const [flag, ...rest] = arg.split('=');
      if (!valueFlags[flag]) throw new Error(`Unknown option: ${flag}`);
      options[valueFlags[flag]] = rest.join('=');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.dryRun && options.execute) {
    throw new Error('--dry-run and --execute are mutually exclusive');
  }
  return options;
}

function printUsage() {
  console.log(`
Usage: node scripts/migrate-to-postgres.mjs [options]

Options:
  --dry-run               Validate and print the migration plan. Read-only (default).
  --execute               Apply the schema and backfill rows (requires DATABASE_URL).
  --source <path>         Bounty JSON to read (use a copy of production data for rehearsal).
  --audit-source <path>   Audit JSON to read.
  --database-url <url>    PostgreSQL connection string (default: DATABASE_URL).
  --backup                Copy the source JSON before executing writes.
  --report <path>         Write a JSON report of the run.
  --rollback              Print the reviewed inverse-DDL rollback plan.
  --help                  Show this message.

Examples:
  node scripts/migrate-to-postgres.mjs --dry-run \\
    --source /tmp/bounties.prod-copy.json \\
    --audit-source /tmp/bounties.audit.prod-copy.json \\
    --report /tmp/postgres-migration-report.json
  node scripts/migrate-to-postgres.mjs --execute --backup \\
    --database-url postgres://user:pass@localhost:5432/bounty_board
`);
}

async function main() {
  let options;
  try {
    options = parseMigrationArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[error] ${error.message}`);
    printUsage();
    process.exit(1);
  }

  if (options.help) {
    printUsage();
    return;
  }

  if (options.rollback) {
    runMigration({ rollback: true });
    return;
  }

  const migrationOptions = {
    jsonPath: options.source || DEFAULT_JSON_PATH,
    auditJsonPath: options.auditSource || DEFAULT_AUDIT_JSON_PATH,
    dryRun: !options.execute,
    execute: options.execute,
    // For --execute the report is written after the transaction commits, so it
    // can include the verification result and never claims success prematurely.
    reportPath: options.execute ? null : options.reportPath,
  };

  const planned = runMigration(migrationOptions);
  const report = planned.report;

  if (!options.execute) return;

  const connectionString = options.databaseUrl || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[error] --execute requires --database-url or DATABASE_URL.');
    process.exit(1);
  }

  if (options.backup) {
    const backupPath = `${planned.plan.jsonPath}.backup.${Date.now()}.json`;
    copyFileSync(planned.plan.jsonPath, backupPath);
    console.log(`[backup] Copied source store to ${backupPath}`);
  }

  try {
    const result = await executeMigration(planned.plan, { databaseUrl: connectionString });
    if (options.reportPath) {
      writeReport(options.reportPath, {
        ...report,
        mode: 'execute',
        executedAt: new Date().toISOString(),
        result,
      });
    }
  } catch (error) {
    console.error(`[error] Migration failed and was rolled back: ${error.message}`);
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath.endsWith('migrate-to-postgres.mjs')) {
  main().catch((error) => {
    console.error(`[error] ${error.message}`);
    process.exit(1);
  });
}
