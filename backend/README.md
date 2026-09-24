# Stellar Bounty Board — Backend

Node.js / Express API for the Stellar Bounty Board platform.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ (for the database-backed setup)
- A `.env` file based on `.env.example`

## Getting started

```bash
cp .env.example .env   # fill in DATABASE_URL and other vars
npm install
npm run dev            # starts the API with hot-reload on port 3001
```

---

## Database migrations (Drizzle ORM)

The project uses **[Drizzle ORM](https://orm.drizzle.team)** with **drizzle-kit** for schema management and migrations.

### Configuration

| File | Purpose |
|------|---------|
| `drizzle.config.ts` | drizzle-kit config — points at the schema file and migrations directory |
| `src/db/schema.ts` | Single source of truth for all table/enum definitions |
| `src/db/index.ts` | Lazy singleton `db` client used by application code |
| `drizzle/migrations/` | Auto-generated and hand-crafted SQL migration files |

The only environment variable required is:

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

### Available scripts

| Script | Command | Description |
|--------|---------|-------------|
| Apply pending migrations | `npm run migrate` | Runs all unapplied SQL files in `drizzle/migrations/` against the target database |
| Generate a new migration | `npm run migrate:generate` | Compares `src/db/schema.ts` against the last snapshot and generates a new SQL file |
| Push schema without migration | `npm run migrate:push` | Directly pushes the current schema to the DB (dev/prototyping only — no migration file is created) |
| Open Drizzle Studio | `npm run migrate:studio` | Launches the browser-based data browser |

### Applying migrations

```bash
# Make sure DATABASE_URL is set, then run:
npm run migrate
```

On a fresh database this creates the `bounties`, `disputes`, and `audit_log`
tables along with the `bounty_status` and `bounty_transition` enum types.

### Creating a new migration

After editing `src/db/schema.ts`, generate a migration:

```bash
npm run migrate:generate
# A new file is created in drizzle/migrations/, e.g.:
#   drizzle/migrations/0001_add_some_column.sql
```

Review the generated SQL, then apply it:

```bash
npm run migrate
```

### Rolling back a migration

Drizzle does not generate automatic rollback scripts. To undo a migration:

1. Write a compensating SQL file (e.g. `0001_add_some_column_rollback.sql`).
2. Apply it directly with `psql` or your preferred client.
3. Delete (or rename) the original migration file from `drizzle/migrations/`.
4. Remove the corresponding entry from `drizzle/migrations/meta/_journal.json`.

For destructive rollbacks in production, always take a snapshot/backup first.

### Schema overview

```
bounties        — core bounty records (status, amounts, timeline fields, events JSONB)
disputes        — one-to-many disputes raised against a bounty
audit_log       — append-only record of every status transition
```

All three tables are created by the initial migration
`drizzle/migrations/0000_initial_schema.sql`.

---

## Running tests

```bash
npm test                # single run
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report
```

Tests use **Vitest**. The CI pipeline spins up a PostgreSQL service container,
runs migrations, and then executes the test suite so all tests run against a
real (ephemeral) database.
