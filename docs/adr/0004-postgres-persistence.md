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

- PostgreSQL is the production standard for all live and containerized deployments.
- A transitional adapter pattern is maintained in the backend store interface, allowing local offline environments to fallback to JSON file storage when `DATABASE_URL` is unset.
- Migration is orchestrated via `scripts/migrate-to-postgres.mjs`.

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
  |     labels           JSONB                                              |
  |     notes            TEXT                                               |
  |     version          INTEGER                                            |
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

The repository provides an automated, idempotent migration runner: `scripts/migrate-to-postgres.mjs`.

### 1. Preflight Validation (`--dry-run`)

Validates existing records in `backend/data/bounties.json` against the schema without modifying the target database:

```bash
node scripts/migrate-to-postgres.mjs --dry-run
```

### 2. Execution with Automatic Backup (`--backup`)

Creates a timestamped snapshot (`backend/data/bounties.backup.<timestamp>.json`), applies relational DDL, and transfers validated rows:

```bash
node scripts/migrate-to-postgres.mjs --backup
```

### 3. Rollback Plan (`--rollback`)

In the event of an operational failure or unplanned maintenance, rollback is executed through:

```bash
node scripts/migrate-to-postgres.mjs --rollback
```

Rollback actions performed:

- Executes inverse DDL statements (`DROP TABLE IF EXISTS audit_log, disputes, bounties CASCADE;`).
- Restores active store state from the latest backup snapshot.
- Restores backend configuration `BOUNTY_STORE=json`.

## Consequences

### Positive

- **ACID Transactions:** Eliminates race conditions during concurrent reservation and settlement.
- **Relational Integrity:** Foreign keys enforce consistency between bounties and disputes.
- **Performance:** B-tree indexes on `repo`, `status`, `maintainer`, and `contributor` accelerate dashboard querying.
- **Audit Trails:** Immutable logging in `audit_log` satisfies compliance requirements.

### Negative

- **Operational Infrastructure:** Production environments require PostgreSQL provisioning.
- **Local Developer Workflow:** Developers opting into PostgreSQL must provide a local database or container (`docker-compose.yml`), though fallback to JSON file storage is maintained.
