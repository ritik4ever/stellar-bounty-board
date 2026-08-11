# ADR-001: JSON vs. PostgreSQL Persistence Decision

## Status

Accepted

## Context

The Stellar Bounty Board needs a persistence layer for storing bounties, events, and user data. The main options were:

1. **JSON file storage** — Simple file-based persistence using the existing JSON store
2. **PostgreSQL** — Full relational database with ACID transactions
3. **SQLite** — Embedded database with zero configuration

## Decision

We chose **JSON file storage** as the primary persistence mechanism for the MVP phase.

### Reasons

- **Rapid prototyping** — No database setup required; developers can clone and run immediately
- **Zero dependencies** — No PostgreSQL installation or Docker requirement for development
- **Simpler CI/CD** — No database service needed in CI pipelines
- **Easy debugging** — Raw JSON files can be inspected and edited directly
- **Sufficient for current scale** — The bounty board operates with moderate data volumes

### Trade-offs

| Factor | JSON Storage | PostgreSQL |
|--------|--------------|------------|
| Setup time | Minutes | Hours |
| Query flexibility | Limited (in-memory filter) | Full SQL |
| Concurrency | Read-only, single-writer | Multi-writer, transactions |
| Data integrity | Application-level | Database-level constraints |
| Scalability | Single server | Horizontal scaling |
| Backup | File copy | pg_dump, replication |

## Consequences

### Positive

- New contributors can start contributing immediately without database setup
- CI runs are fast and don't require database services
- Development iteration is faster without schema migrations

### Negative

- No built-in query language — filtering must be done in application code
- No concurrent write safety — write operations should be serialized
- Data may not scale beyond tens of thousands of records

### Migration Path

If PostgreSQL is needed in the future:
1. Use the existing `bountyStore.ts` interface as the abstraction boundary
2. Implement a `PostgresBountyStore` class implementing the same interface
3. Add a `DATABASE_URL` environment variable to switch between backends
4. Run a one-time migration script to import JSON data to PostgreSQL
