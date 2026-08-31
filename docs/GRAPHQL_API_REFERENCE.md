# GraphQL API Reference (Proposed — Not Yet Implemented)

> **Status: Design proposal.** As of this writing, the backend exposes only a REST API (see `backend/src/app.ts` and `/api/docs` for the live OpenAPI/Swagger spec). No GraphQL server, schema, or resolvers currently exist in this repository. This document proposes a GraphQL schema that mirrors the REST API's existing capabilities, to be implemented and validated once GraphQL support lands. Example queries below are illustrative and have **not** been executed against a live endpoint.

## Overview

The REST API is organized around a single core resource, the **Bounty**, plus supporting read endpoints for leaderboards, metrics, and audit logs. This proposal maps those same capabilities onto a GraphQL schema.

## Proposed Schema

```graphql
type Bounty {
  id: ID!
  repo: String!
  issueNumber: Int!
  status: BountyStatus!
  amount: Float!
  tokenSymbol: String!
  contributor: String
  maintainer: String
  deadline: Int
  createdAt: Int
  releasedAt: Int
  version: Int
  notes: String
}

enum BountyStatus {
  OPEN
  RESERVED
  SUBMITTED
  RELEASED
  REFUNDED
  CANCELED
  DISPUTED
}

type BountyEvent {
  type: String!
  timestamp: Int!
  actor: String
}

type AuditLogEntry {
  actor: String!
  transition: String!
  fromStatus: BountyStatus
  toStatus: BountyStatus
  timestamp: Int!
}

type LeaderboardEntry {
  contributor: String!
  totalReleased: Float!
  bountyCount: Int!
}

type Query {
  """Mirrors GET /api/bounties — filterable, paginated bounty listing."""
  bounties(
    q: String
    contributor: String
    maintainer: String
    status: BountyStatus
    tokenSymbol: String
    deadlineBefore: String
    deadlineAfter: String
    sort: String
    order: String
    page: Int
    pageSize: Int
  ): BountyConnection!

  """Mirrors GET /api/bounties/:id"""
  bounty(id: ID!): Bounty

  """Mirrors GET /api/bounties/by-issue"""
  bountyByIssue(repo: String!, issue: Int!): Bounty

  """Mirrors GET /api/bounties/:id/events"""
  bountyEvents(id: ID!): [BountyEvent!]!

  """Mirrors GET /api/bounties/:id/audit-logs"""
  bountyAuditLogs(id: ID!, limit: Int, offset: Int): [AuditLogEntry!]!

  """Mirrors GET /api/leaderboard"""
  leaderboard(limit: Int): [LeaderboardEntry!]!
}

type BountyConnection {
  data: [Bounty!]!
  total: Int!
  page: Int!
  pageSize: Int!
  hasMore: Boolean!
}

type Mutation {
  """Mirrors POST /api/bounties — requires signature auth per REST implementation."""
  createBounty(repo: String!, issueNumber: Int!, amount: Float!, tokenSymbol: String!, deadline: Int): Bounty!

  """Mirrors POST /api/bounties/:id/reserve"""
  reserveBounty(id: ID!, contributor: String!, expectedVersion: Int): Bounty!

  """Mirrors POST /api/bounties/:id/submit"""
  submitBounty(id: ID!, contributor: String!, submissionUrl: String!, notes: String): Bounty!

  """Mirrors POST /api/bounties/:id/release — maintainer-signed action."""
  releaseBounty(id: ID!, maintainer: String!, transactionHash: String!): Bounty!

  """Mirrors POST /api/bounties/:id/refund — maintainer-signed action."""
  refundBounty(id: ID!, maintainer: String!, transactionHash: String!): Bounty!

  """Mirrors POST /api/bounties/:id/cancel — maintainer-signed action."""
  cancelBounty(id: ID!, maintainer: String!, transactionHash: String!): Bounty!

  """Mirrors POST /api/bounties/:id/dispute"""
  disputeBounty(id: ID!, contributor: String!, reason: String!): Bounty!

  """Mirrors PATCH /api/bounties/:id/notes — maintainer-signed action."""
  updateBountyNotes(id: ID!, maintainer: String!, notes: String!): Bounty!

  """Mirrors POST /api/bounties/:id/extend-deadline — maintainer-signed action."""
  extendDeadline(id: ID!, maintainer: String!, newDeadline: Int!): Bounty!
}
```

## Example Queries (Illustrative — Untested)

```graphql
# List open bounties, mirrors GET /api/bounties?status=open
query OpenBounties {
  bounties(status: OPEN, page: 1, pageSize: 20) {
    data {
      id
      repo
      issueNumber
      amount
      tokenSymbol
      status
    }
    total
    hasMore
  }
}

# Create a bounty, mirrors POST /api/bounties
mutation CreateBounty {
  createBounty(
    repo: "ritik4ever/stellar-bounty-board"
    issueNumber: 881
    amount: 100
    tokenSymbol: "XLM"
  ) {
    id
    status
  }
}

# Resolve a dispute, mirrors POST /api/bounties/:id/dispute
mutation DisputeBounty {
  disputeBounty(
    id: "abc-123"
    contributor: "GABC...XYZ"
    reason: "Submission was rejected without review."
  ) {
    id
    status
  }
}
```

## Known REST-Only Capabilities (Not Yet Mapped to GraphQL Proposal)

The following existing REST endpoints have no GraphQL equivalent proposed above yet, and would need further design work:
- `GET /api/bounties/released/export.csv` — CSV export is a REST-specific/file-download concept; GraphQL would need a different pattern (e.g., a mutation returning a signed URL, or leaving this as a REST-only endpoint).
- `GET /api/audit-log` (global, admin-only) — admin-gated cross-bounty audit log; would need equivalent auth-aware resolver design.
- `GET /api/metrics`, `/api/global-metrics`, `/api/stats`, `/api/maintainers/:maintainer/metrics` — Prometheus-format metrics and aggregate stats; only `leaderboard` has been mapped so far.
- `POST /api/webhooks/github` — webhook ingestion is inherently a REST/HTTP callback pattern, not naturally suited to GraphQL.
- Idempotency-key behavior on mutation endpoints (via `idempotencyMiddleware`) is not yet reflected in the mutation signatures above.

## Local Development

There is currently no GraphQL playground or endpoint to link, since GraphQL is not implemented. Once implemented, this section should include:
- The local dev GraphQL endpoint URL (e.g., `http://localhost:PORT/graphql`)
- Playground/introspection tooling instructions

For the existing REST API, local docs and an interactive explorer are available at `/api/docs` (Swagger UI), generated via `backend/src/docs/openapi.ts`.