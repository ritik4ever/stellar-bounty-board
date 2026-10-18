import { buildSchema, type GraphQLSchema } from 'graphql';

/**
 * GraphQL schema definition covering Bounties, Disputes, Maintainer & Contributor profiles (#789).
 */
export const typeDefs = `
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
`;

export const schema: GraphQLSchema = buildSchema(typeDefs);
