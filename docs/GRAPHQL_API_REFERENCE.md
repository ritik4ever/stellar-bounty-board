# GraphQL API Reference

> **Status: Active & Implemented (#789).** The backend exposes a GraphQL API layer alongside the REST API, mounted at the `/graphql` route. Resolvers delegate directly to the existing backend service layer (`bountyStore`, `notificationService`) without duplicating business logic, and request complexity is enforced via query depth and selection complexity limiting.

---

## Overview

The GraphQL endpoint allows clients to query bounties, disputes, maintainer metrics/profiles, contributor profiles, and global escrow statistics in a single round-trip.

- **Route:** `POST /graphql` and `GET /graphql`
- **Content-Type:** `application/json`
- **Query Complexity Protection:**
  - Maximum query depth: `5`
  - Maximum query complexity: `100`
  - Overly deep or complex queries are rejected with HTTP 400 and descriptive GraphQL error objects before execution.

---

## GraphQL Schema

```graphql
type Bounty {
  id: ID!
  repo: String!
  issueNumber: Int!
  title: String!
  summary: String!
  maintainer: String!
  contributor: String
  tokenSymbol: String!
  tokenAddress: String!
  amount: Float!
  labels: [String!]!
  status: String!
  createdAt: Float!
  deadlineAt: Float!
  reservedAt: Float
  submittedAt: Float
  releasedAt: Float
  refundedAt: Float
  submissionUrl: String
  notes: String
  disputedAt: Float
  disputeReason: String
  prMerged: Boolean
  prMergedAt: Float
  version: Int
}

type Dispute {
  bountyId: ID!
  reason: String!
  status: String!
  disputedAt: Float!
  maintainer: String!
  contributor: String
}

type MaintainerMetrics {
  totalBounties: Int!
  openCount: Int!
  reservedCount: Int!
  submittedCount: Int!
  releasedCount: Int!
  refundedCount: Int!
  expiredCount: Int!
  totalFunded: Float!
  totalReleased: Float!
  averageRewardAmount: Float!
}

type MaintainerProfile {
  address: String!
  metrics: MaintainerMetrics!
  bounties: [Bounty!]!
}

type ContributorProfile {
  address: String!
  reservedCount: Int!
  submittedCount: Int!
  completedCount: Int!
  totalEarned: Float!
  bounties: [Bounty!]!
}

type GlobalMetrics {
  totalBounties: Int!
  openBounties: Int!
  totalFundedXlm: Float!
  totalPaidOutXlm: Float!
  activeContributorsCount: Int!
}

type Query {
  bounty(id: ID!): Bounty
  bounties(status: String, maintainer: String, contributor: String, limit: Int): [Bounty!]!
  disputes(status: String): [Dispute!]!
  maintainerProfile(address: String!): MaintainerProfile
  contributorProfile(address: String!): ContributorProfile
  metrics: GlobalMetrics!
}
```

---

## Example Queries

### 1. Query a Bounty by ID

```graphql
query GetBounty($id: ID!) {
  bounty(id: $id) {
    id
    repo
    issueNumber
    title
    amount
    tokenSymbol
    status
    maintainer
    contributor
  }
}
```

**Variables:**

```json
{
  "id": "BNT-0001"
}
```

### 2. Query Bounties Filtered by Status

```graphql
query ListOpenBounties {
  bounties(status: "open", limit: 10) {
    id
    repo
    issueNumber
    title
    amount
    tokenSymbol
  }
}
```

### 3. Query Maintainer Profile and Metrics

```graphql
query GetMaintainer($address: String!) {
  maintainerProfile(address: $address) {
    address
    metrics {
      totalBounties
      totalFunded
      totalReleased
      averageRewardAmount
    }
    bounties {
      id
      title
      status
      amount
    }
  }
}
```

### 4. Query Contributor Profile

```graphql
query GetContributor($address: String!) {
  contributorProfile(address: $address) {
    address
    completedCount
    totalEarned
    bounties {
      id
      title
      status
    }
  }
}
```

### 5. Query Active Disputes

```graphql
query GetDisputes {
  disputes(status: "disputed") {
    bountyId
    reason
    status
    disputedAt
    maintainer
    contributor
  }
}
```

### 6. Query Global Escrow Metrics

```graphql
query GetGlobalMetrics {
  metrics {
    totalBounties
    openBounties
    totalFundedXlm
    totalPaidOutXlm
    activeContributorsCount
  }
}
```

---

## Query Complexity & Depth Limiting

To prevent Denial-of-Service and recursive nested query abuse, all incoming GraphQL operations are inspected before execution:

- Queries with selection nesting exceeding **5 levels** are rejected:
  ```json
  {
    "errors": [
      {
        "message": "Query depth limit exceeded: depth of 6 exceeds maximum allowed depth of 5."
      }
    ]
  }
  ```
- Queries exceeding maximum total complexity (default 100) are rejected with a corresponding HTTP 400 error.
