---
title: 0001 - JSON file persistence
date: 2026-05-29
status: superseded
superseded_by: 0004-postgres-persistence.md
---

# ADR 0001: Choose JSON file persistence for the backend

> **Status:** Superseded by [ADR 0004: Move from JSON file storage to PostgreSQL persistence](0004-postgres-persistence.md).

## Retention for the remaining JSON store

The JSON fallback still serves bounty API reads. It keeps open, reserved,
submitted, disputed, expired, and recently released/refunded records in
`backend/data/bounties.json`. A job runs at startup and every 24 hours. It moves
released/refunded records more than 90 days past `releasedAt`/`refundedAt` to
`backend/data/bounties.archive.json`; `ARCHIVE_AFTER_DAYS` and
`ARCHIVE_JOB_INTERVAL_MS` configure those defaults. For older records missing a
terminal timestamp, the job uses `createdAt`. Previously soft-archived terminal
records are also moved. `BOUNTY_ARCHIVE_PATH` can put the archive elsewhere.

Public list and detail reads parse only the active file. Archived records leave
the public API and remain in the cold archive for offline inspection/export and
backup. Creating a bounty checks the archive for the highest allocated ID, so
IDs are never reused. The job writes the archive first, then removes moved
records from the active file; retries deduplicate by ID after an interrupted
run. Back up both files together. There is no byte cap on active bounties or on
the archive; active growth is bounded by the number of nonterminal and recent
terminal records, while the cold archive can grow until an operator exports or
rotates it. This policy applies to the JSON fallback, not PostgreSQL.

To measure the hot read cost with 10,000 old terminal and 100 active records,
run `cd backend && node --import tsx scripts/benchmark-bounty-archive.ts`. It reports
active file bytes and median `listBounties()` latency over 100 measured reads
before and after moving old records. The benchmark uses a temporary store.
On 2026-10-22, this measured 3,581,695 → 42,402 active bytes and
11.90 → 0.19 ms median read latency on a local Mac (one run; results vary by machine).

## Context / Problem

The backend stores bounty state. We must choose a persistence strategy that
matches the project's goals for simplicity, ease of contribution, and
operational cost. At project start the team chose a JSON file store; this ADR
documents why and when we should migrate to a database.

## Options considered

- JSON file (current): simple file-backed store (`backend/data/bounties.json`)
- SQLite: lightweight single-file SQL database with transactional safety
- PostgreSQL: full relational DB with strong concurrency, reliability, and
  long-term scaling capabilities

## Decision

We will continue to use JSON file persistence for the MVP and near-term
development. The file-backed store is the default and documented in the
repository. This keeps the project easy for contributors to run locally and
reduces operational complexity for demos and teaching scenarios.

## Rationale

- Simplicity: JSON requires no additional dependencies or infra to run locally.
- Ease of contribution: new contributors can run and test the backend without
  installing a database or managing migrations.
- Observability: the full data set is human-readable and easy to inspect.
- YAGNI for MVP: current workload and team size do not justify DB operational
  overhead.

## Consequences

- Concurrency: file-based store requires application-level locking for safe
  concurrent writes. The current code tries to minimize race windows but is
  not a replacement for a transactional DB under high contention.
- Durability & integrity: moving to a DB improves atomicity and recovery
  properties; the JSON store is more fragile to partial writes or crashes.
- Migrations: switching to SQL will require a migration path and tests to
  ensure no data loss.

## Migration path

When the project needs stronger concurrency, durability, or analytical
capabilities, prefer the following progressive path:

1. Add a compatibility layer (adapter) that implements the current store
   interface but translates operations to SQL. Keep the JSON store as a
   fallback for local developer workflows.
2. Provide a one-time migration script that reads `backend/data/bounties.json`
   and writes rows into the target database (SQLite/Postgres). Include an
   option to create backups before migration.
3. Run integration tests against Postgres and enable the DB adapter by
   configuration (e.g., `BOUNTY_STORE=postgres`).

Prefer PostgreSQL for production deployments and SQLite for a single-node
testable alternative during transition.

## Known limitations

- Not suitable for high write concurrency or large datasets.
- Requires careful testing of recovery and backup procedures.

## When to migrate

- Sustained concurrency errors or lost/overwritten reservations.
- Need for multi-instance backend scaling.
- Requirements for complex queries, reporting, or audit logs that are
  inefficient on a file store.

---

This ADR is referenced from the main README and serves as the canonical
explanation for the JSON-first persistence decision.
