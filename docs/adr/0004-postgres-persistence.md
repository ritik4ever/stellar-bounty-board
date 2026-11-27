---
title: 0004 - PostgreSQL persistence superseding JSON file storage
date: 2026-10-18
status: accepted
supersedes: 0001-json-file-persistence.md
---

# ADR 0004: Move from JSON file storage to PostgreSQL persistence

## Status

Accepted. Supersedes [ADR 0001: Choose JSON file persistence for the backend](0001-json-file-persistence.md).

## Context / Problem

In ADR 0001, the team accepted a JSON file-backed persistence layer (`backend/data/bounties.json`) for the MVP to prioritize quick local setup, ease of contribution, and zero initial infrastructure cost.

As the platform has matured across Waves 1 through 6, the limitations explicitly anticipated in ADR 0001 have materialized:

1. **High Concurrency and Multi-Instance Deployments:** File-based lock contention leads to race conditions when multiple maintainers and contributors interact simultaneously.
2. **ACID Transaction Guarantees:** Multi-step operations—such as dispute creation, arbiter resolution, and payout disbursement—require strict relational transactions rather than coarse file-level writes.
3. **Auditability & Reporting:** Enterprise escrow tracking necessitates queryable audit logging, indexing, and relational integrity across bounties, disputes, and audit trails.

## Decision

We will migrate the primary persistence store from JSON flat files to **PostgreSQL**.

- PostgreSQL is the **single** target. SQLite via Drizzle ORM was proposed separately in Wave 4 item 33 and Wave 5 item 17; both items were amended to point here during the reconciliation tracked in Issue #1169. No SQLite/Drizzle migration path will be built.
- A transitional adapter pattern is maintained in the backend store interface, allowing local offline environments to fallback to JSON file storage when `DATABASE_URL` is unset.
- Migration is orchestrated via `scripts/migrate-to-postgres.mjs`, which backfills existing JSON records into PostgreSQL idempotently. The pre-cutover rehearsal is documented in [postgres-migration.md](../postgres-migration.md).

## Current status

The backfill tooling and schema exist and are exercised against a throwaway PostgreSQL instance. The runtime store adapter and the `DATABASE_URL` cutover switch are still Wave 6 item 1 work; until that lands, `backend/data/bounties.json` remains authoritative for API reads and writes. This ADR records the destination, not that the cutover has already happened.

## Data Model

The relational architecture introduces three primary tables: `bounties`, `disputes`, and `audit_log`.

```
  +-------------------------------------------------------------------------+
  |                               bounties                                  |
  +-------------------------------------------------------------------------+
  | PK  id               VARCHAR(64)                                        |
  |     repo             VARCHAR(255)                                       |
  |     issue_number     INTEGER                                            |
  |     title            TEXT                                               |
  |     summary          TEXT                                               |
  |     amount           NUMERIC(20,7)                                      |
  |     token_symbol     VARCHAR(16)                                        |
  |     maintainer       VARCHAR(64)                                        |
  |     contributor      VARCHAR(64)                                        |
  |     status           VARCHAR(32)                                        |
  |     created_at       BIGINT                                             |
  |     deadline_at      BIGINT                                             |
  |     reserved_at      BIGINT                                             |
  |     submitted_at     BIGINT                                             |
  |     released_at      BIGINT                                             |
  |     refunded_at      BIGINT                                             |
  |     released_tx_hash VARCHAR(128)                                       |
  |     refunded_tx_hash VARCHAR(128)                                       |
  |     escrow_status    VARCHAR(32)                                        |
  |     token_address    VARCHAR(128)                                       |
  |     submission_url   TEXT                                               |
  |     labels           JSONB                                              |
  |     events           JSONB                                              |
  |     notes            TEXT                                               |
  |     version          INTEGER                                            |
  |     reservation_timeout_seconds INTEGER                                  |
  |     payload          JSONB  -- full source record, lossless safety net   |
  |     updated_at       TIMESTAMPTZ                                        |
  +-------------------------------------------------------------------------+
                                 | 1
                                 |
                                 | N
  +------------------------------v------------------------------------------+
  |                               disputes                                  |
  +-------------------------------------------------------------------------+
  | PK  id               VARCHAR(64)                                        |
  | FK  bounty_id        VARCHAR(64) REFERENCES bounties(id) ON DELETE CASCADE |
  |     initiator        VARCHAR(64)                                        |
  |     reason           TEXT                                               |
  |     status           VARCHAR(32)                                        |
  |     resolution       TEXT                                               |
  |     arbiter          VARCHAR(64)                                        |
  |     created_at       BIGINT                                             |
  |     resolved_at      BIGINT                                             |
  +-------------------------------------------------------------------------+

  +-------------------------------------------------------------------------+
  |                              audit_log                                  |
  +-------------------------------------------------------------------------+
  | PK  id               SERIAL                                             |
  |     entity_type      VARCHAR(32)                                        |
  |     entity_id        VARCHAR(64)                                        |
  |     action           VARCHAR(64)                                        |
  |     actor            VARCHAR(64)                                        |
  |     details          JSONB                                              |
  |     created_at       BIGINT                                             |
  +-------------------------------------------------------------------------+
```

## Migration Script Usage

The repository provides an automated, idempotent backfill runner: `scripts/migrate-to-postgres.mjs`.
The full pre-cutover rehearsal procedure, including a recorded dry-run against a data copy,
is documented in [postgres-migration.md](../postgres-migration.md).

### 1. Preflight Validation (`--dry-run`, default)

Reads a copy of the JSON store and its audit store, validates every record, and prints the
migration plan. It never connects to PostgreSQL and never writes to the source:

```bash
node scripts/migrate-to-postgres.mjs --dry-run \
  --source /tmp/bounties.prod-copy.json \
  --audit-source /tmp/bounties.audit.prod-copy.json \
  --report /tmp/postgres-migration-report.json
```

### 2. Execution with Automatic Backup (`--execute --backup`)

Creates a timestamped snapshot, applies the idempotent DDL, and backfills bounties and audit
records in a single transaction. Verification compares every migrated row against the source
before commit; any mismatch rolls the whole run back:

```bash
node scripts/migrate-to-postgres.mjs --execute --backup \
  --source /tmp/bounties.prod-copy.json \
  --audit-source /tmp/bounties.audit.prod-copy.json \
  --database-url "$DATABASE_URL"
```

Re-running the command is safe: bounty rows are upserted by `id`, and audit rows are guarded
by a `NOT EXISTS` check on entity, action, actor and timestamp.

### 3. Rollback Plan (`--rollback`)

Prints the reviewed inverse-DDL plan; it deliberately does not drop tables by itself:

```bash
node scripts/migrate-to-postgres.mjs --rollback
```

An operator applies the printed plan only after confirming the cutover must be undone. Because
the JSON store stays authoritative until Wave 6 completes the runtime adapter, the usual
rollback is simply to keep serving from JSON and drop the partially populated tables.

## Consequences

### Positive

- **ACID Transactions:** Eliminates race conditions during concurrent reservation and settlement.
- **Relational Integrity:** Foreign keys enforce consistency between bounties and disputes.
- **Performance:** B-tree indexes on `repo`, `status`, `maintainer`, and `contributor` accelerate dashboard querying.
- **Audit Trails:** Immutable logging in `audit_log` satisfies compliance requirements.

### Negative

- **Operational Infrastructure:** Production environments require PostgreSQL provisioning.
- **Local Developer Workflow:** Developers opting into PostgreSQL must provide a local database or container (`docker-compose.yml`), though fallback to JSON file storage is maintained.
