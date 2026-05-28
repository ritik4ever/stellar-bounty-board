# ADR 0001: JSON File Persistence

## Status
Accepted

## Context
The stellar-bounty-board started as a lightweight MVP. The initial persistence choice affects development speed, deployment complexity, and long-term scalability.

Requirements:
- Zero external dependencies for local development
- Easy to reset for testing
- Simple enough for new contributors to understand quickly
- Must support concurrent read access from the API and worker processes

## Options Considered

### Option 1: JSON File (Chosen)
- **Pros**: Zero setup, easy to inspect/modify manually, git-friendly for small datasets, trivial to reset
- **Cons**: No concurrent write safety, no query capabilities, performance degrades with large datasets

### Option 2: SQLite
- **Pros**: Single-file, ACID-compliant, concurrent reads, SQL queries, well-tested
- **Cons**: Requires `better-sqlite3` native dependency, harder to inspect without CLI, write locks on concurrent access

### Option 3: PostgreSQL
- **Pros**: Full ACID, concurrent reads/writes, network-accessible, battle-tested
- **Cons**: Requires external server, adds deployment complexity, overkill for current data volume

## Decision
Use JSON file persistence for the MVP phase. The dataset is small (hundreds of bounties, not millions) and JSON files provide the fastest development iteration.

## Consequences
- **Positive**: Anyone can clone and run without database setup
- **Positive**: Bounty data is human-readable and debuggable
- **Negative**: Must implement file locking if write contention grows
- **Negative**: Will need migration to SQLite or PostgreSQL when data exceeds ~10K records

## Migration Path
When JSON persistence becomes a bottleneck:
1. Extract `BountyStore` interface from current implementation
2. Implement a SQLite adapter using `better-sqlite3`
3. Add a `STORAGE_BACKEND=sqlite` env var
4. Include a `scripts/migrate-json-to-sqlite.js` migration script
5. Document the migration in `docs/migration.md`

## References
- [bountyStore.ts](../backend/src/services/bountyStore.ts) - Current JSON implementation
- [Issue #332](https://github.com/ritik4ever/stellar-bounty-board/issues/332)
