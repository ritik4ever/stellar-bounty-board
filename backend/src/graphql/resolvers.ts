import { listBounties, getMaintainerMetrics, getGlobalMetrics } from '../services/bountyStore';

/**
 * GraphQL resolvers delegating directly to bountyStore service layer (#789).
 */
export const resolvers = {
  bounty: ({ id }: { id: string }) => {
    const bounties = listBounties();
    return bounties.find((b) => b.id === id) || null;
  },

  bounties: ({
    status,
    maintainer,
    contributor,
    limit,
  }: {
    status?: string;
    maintainer?: string;
    contributor?: string;
    limit?: number;
  }) => {
    let result = listBounties();
    if (status) {
      result = result.filter((b) => b.status === status);
    }
    if (maintainer) {
      result = result.filter((b) => b.maintainer === maintainer);
    }
    if (contributor) {
      result = result.filter((b) => b.contributor === contributor);
    }
    if (limit && limit > 0) {
      result = result.slice(0, limit);
    }
    return result;
  },

  disputes: ({ status }: { status?: string }) => {
    const bounties = listBounties();
    let disputed = bounties.filter((b) => b.status === 'disputed' || Boolean(b.disputedAt));
    if (status) {
      disputed = disputed.filter((b) => b.status === status);
    }
    return disputed.map((b) => ({
      bountyId: b.id,
      reason: b.disputeReason || 'No dispute reason specified',
      status: b.status,
      disputedAt: b.disputedAt || b.createdAt,
      maintainer: b.maintainer,
      contributor: b.contributor,
    }));
  },

  maintainerProfile: ({ address }: { address: string }) => {
    const all = listBounties();
    const maintainerBounties = all.filter((b) => b.maintainer === address);
    const metrics = getMaintainerMetrics(address);
    return {
      address,
      metrics,
      bounties: maintainerBounties,
    };
  },

  contributorProfile: ({ address }: { address: string }) => {
    const all = listBounties();
    const contributorBounties = all.filter((b) => b.contributor === address);
    const reservedCount = contributorBounties.filter((b) => b.status === 'reserved').length;
    const submittedCount = contributorBounties.filter((b) => b.status === 'submitted').length;
    const completedCount = contributorBounties.filter((b) => b.status === 'released').length;
    const totalEarned = contributorBounties
      .filter((b) => b.status === 'released')
      .reduce((sum, b) => sum + (b.amount || 0), 0);

    return {
      address,
      reservedCount,
      submittedCount,
      completedCount,
      totalEarned,
      bounties: contributorBounties,
    };
  },

  metrics: () => {
    const globalMetrics = getGlobalMetrics();
    return {
      totalBounties: globalMetrics.totalBounties || 0,
      openBounties: globalMetrics.openBounties || 0,
      totalFundedXlm: globalMetrics.totalFundedXlm || 0,
      totalPaidOutXlm: globalMetrics.totalPaidOutXlm || 0,
      activeContributorsCount: globalMetrics.activeContributorsCount || 0,
    };
  },
};
