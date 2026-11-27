# PostgreSQL Migration Runbook

This runbook covers the one-time move from the JSON file store to PostgreSQL. It implements
the accepted decision in [ADR 0004](adr/0004-postgres-persistence.md).

**Single target:** PostgreSQL. The SQLite/Drizzle variant that previously appeared in
Wave 4 item 33 and Wave 5 item 17 was retired during the reconciliation for Issue #1169;
Wave 6 item 1 is the only backlog item that owns the persistence cutover.

The backfill tool is [`scripts/migrate-to-postgres.mjs`](../scripts/migrate-to-postgres.mjs).
It:

- reads `backend/data/bounties.json` and `backend/data/bounties.audit.json`;
- validates every record before touching a database;
- backfills `bounties` with upserts keyed on `id`, so re-runs are idempotent;
- backfills the append-only `audit_log`, skipping events that already exist;
- stores the complete source record in `bounties.payload` so fields without a dedicated
  column are not lost;
- verifies every row and audit event inside the transaction and rolls back on any mismatch.

It does **not** switch the running backend to PostgreSQL. The runtime store adapter and the
`DATABASE_URL` switch are Wave 6 item 1 work. Until that lands, the JSON store remains
authoritative for API reads and writes.

## Prerequisites

- Node.js 20 or newer (the script uses the `pg` package installed at the repository root).
- PostgreSQL 14 or newer, reachable from the machine running the migration.
- A copy of the production JSON data. Never point `--source` at the live store.
- `DATABASE_URL` (or `--database-url`) for the target database.

## Step 1 — Copy the production data

Reading the live file while the API is still writing it can capture a partial write. Take a
copy and record its checksum:

```bash
mkdir -p /tmp/bounty-migration
cp backend/data/bounties.json /tmp/bounty-migration/bounties.prod-copy.json
cp backend/data/bounties.audit.json /tmp/bounty-migration/bounties.audit.prod-copy.json
sha256sum /tmp/bounty-migration/bounties.prod-copy.json
```

If the deployment sets `BOUNTY_STORE_PATH` or `BOUNTY_ARCHIVE_PATH`, copy from those paths
instead. The runbook assumes the repository defaults.

## Step 2 — Dry-run against the data copy

This is the required rehearsal before cutover. It is read-only: no database connection is
made and the copied files are not modified.

```bash
node scripts/migrate-to-postgres.mjs --dry-run \
  --source /tmp/bounty-migration/bounties.prod-copy.json \
  --audit-source /tmp/bounty-migration/bounties.audit.prod-copy.json \
  --report /tmp/bounty-migration/report.json
```

Recorded against a copy of the committed store on 2026-10-22:

```text
=== Stellar Bounty Board: Postgres Migration Runner ===
[source] /tmp/bounty-migration/bounties.prod-copy.json
[source] sha256 250ad6bc0b217c5fb3d3bad407c9f6343ef3978e84ebc87e9c627cf497126d9d
[source] 2 bounty records, 90 audit records
[status] {"reserved":1,"open":1}
[warning] Audit store references 87 entity id(s) with no matching bounty: BNT-0003, BNT-0004, BNT-0005, BNT-0006, BNT-0007…. They are preserved in audit_log.
[plan] Schema DDL ready (bounties, disputes, audit_log).
[plan] 2 idempotent bounty upserts
[plan] 90 deduplicated audit inserts
[report] Wrote migration report to /tmp/bounty-migration/report.json
[dry-run] Validation passed. No database connection was made and no data changed.
```

The committed fixture is small; a production copy will report its own counts. What matters:

| Report field          | Expected before cutover                                               |
| --------------------- | --------------------------------------------------------------------- |
| `source.sha256`       | Matches `sha256sum` of the copied file.                               |
| `counts.bounties`     | Matches the record count in the JSON array.                           |
| `counts.auditRecords` | Matches the audit array length.                                       |
| `statuses`            | Only the app's known statuses (unknown values are warned about).      |
| `warnings`            | Reviewed; orphaned audit ids are expected for archived bounties.      |
| `validation.ok`       | `true`. Any validation error exits with code 1 and no report is used. |

Any validation error names the record index and the missing field. Fix or explain the record
before continuing.

## Step 3 — Rehearse against a scratch database

Run the real backfill against a throwaway PostgreSQL instance first. This catches schema and
permission problems without touching production:

```bash
docker run -d --rm --name bounty-migration-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=bounty_board \
  -p 55432:5432 postgres:16-alpine

until docker exec bounty-migration-pg pg_isready -U postgres -d bounty_board; do sleep 1; done

node scripts/migrate-to-postgres.mjs --execute \
  --source /tmp/bounty-migration/bounties.prod-copy.json \
  --audit-source /tmp/bounty-migration/bounties.audit.prod-copy.json \
  --database-url postgres://postgres:postgres@localhost:55432/bounty_board
```

Recorded result for the fixture:

```text
[execute] Applied idempotent schema DDL.
[execute] Backfilled 2 bounty rows.
[execute] Backfilled 90 audit records.
[execute] Verification passed. Transaction committed.
```

Check the data and the idempotency guarantee:

```bash
docker exec bounty-migration-pg psql -U postgres -d bounty_board -c \
  "select id, repo, status, amount, version,
          jsonb_array_length(labels) as labels,
          jsonb_array_length(events) as events
     from bounties order by id;"
docker exec bounty-migration-pg psql -U postgres -d bounty_board -c \
  "select count(*) from audit_log;"
```

Expected for the fixture: `BNT-0001` and `BNT-0002` with their statuses, amounts and event
arrays intact, and 90 audit rows. Re-run the same `--execute` command; the counts must stay
at 2 bounties and 90 audit rows. Delete the scratch container afterwards with
`docker rm -f bounty-migration-pg`.

## Step 4 — Cutover

1. Announce the maintenance window and stop backend writes, or accept that bounties created
   after the copy are not included.
2. Take a fresh copy of the store (Step 1) and repeat the dry-run (Step 2).
3. Execute with a backup and the production connection string:

   ```bash
   node scripts/migrate-to-postgres.mjs --execute --backup \
     --source /tmp/bounty-migration/bounties.prod-copy.json \
     --audit-source /tmp/bounty-migration/bounties.audit.prod-copy.json \
     --report /tmp/bounty-migration/report-execute.json \
     --database-url "$DATABASE_URL"
   ```

   `--backup` writes `bounties.prod-copy.json.backup.<timestamp>.json` next to the source.
   The command exits non-zero and rolls back the transaction if validation or verification
   fails, so a failure leaves the target database unchanged.

4. Keep `backend/data/bounties.json` and its backup in place. They are the rollback source
   until the runtime adapter is enabled and verified.

## Step 5 — Verify and roll back if needed

After cutover, verify counts and spot-check a few bounties:

```bash
psql "$DATABASE_URL" -c "select status, count(*) from bounties group by status;"
psql "$DATABASE_URL" -c \
  "select id, payload->>'title' as title from bounties order by created_at desc limit 5;"
```

For a rollback before or after the switch:

- If the cutover has not switched the app to PostgreSQL yet, keep serving from JSON and drop
  the partially populated tables.
- Review the inverse-DDL plan rather than running it blindly:

  ```bash
  node scripts/migrate-to-postgres.mjs --rollback
  ```

  It prints `DROP TABLE IF EXISTS audit_log, disputes, bounties` inside a transaction. Apply
  it through `psql "$DATABASE_URL"` only after confirming the JSON copy is intact and no
  PostgreSQL writes are being accepted.

## Troubleshooting

| Symptom                                                     | Cause / fix                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `The 'pg' package is required…`                             | Run `npm install` at the repository root.                                                                                       |
| `A PostgreSQL connection string is required`                | Pass `--database-url` or export `DATABASE_URL`.                                                                                 |
| `Invalid bounty #…: missing tokenSymbol` (or another field) | The record does not satisfy a `NOT NULL` column. Backfill the field in JSON or explain it before migrating.                     |
| `Duplicate bounty id "…"`                                   | The source contains two records with the same id. Deduplicate before running; the primary key would reject one of them.         |
| Warning about status not known                              | The status is migrated as-is, but the app may not recognise it. Correct the source status if that is unintended.                |
| Warning about orphaned audit entity ids                     | Audit rows reference bounties no longer in the active store (for example archived bounties). They are preserved in `audit_log`. |
| Audit record missing a timestamp                            | The script falls back to `metadata.deadlineAt`, matching the JSON audit store.                                                  |
