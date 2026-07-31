# Replace JSON Persistence With Postgres And Audit Logs

Labels: `backend`, `database`, `help wanted`

## Summary

Move storage from a local JSON file to Postgres and add an append-only audit log for every bounty state transition.

## Why It Matters

- JSON storage is fine for an MVP but weak for multi-user reliability
- Audit logs make payouts and refunds easier to trust
- This lays the groundwork for indexer and analytics features

## Acceptance Criteria

- Bounty records are stored in Postgres
- Audit log captures actor, transition, timestamp, and metadata
- Existing API routes keep the same response shape
- Local setup instructions are updated in the README

