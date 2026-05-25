export interface OpenIssue {
  id: string;
  title: string;
  labels: string[];
  summary: string;
  impact: 'starter' | 'core' | 'advanced';
}

const openIssues: OpenIssue[] = [
  {
    id: 'SBB-101',
    title: 'Add Freighter wallet signing for maintainer-only release and refund actions',
    labels: ['enhancement', 'help wanted', 'wallet'],
    summary:
      'Replace prompt-based demo actions with wallet-authenticated Soroban transactions so release and refund flows match real maintainer permissions.',
    impact: 'core',
  },
  {
    id: 'SBB-102',
    title: 'Sync bounty submissions from GitHub pull request webhooks',
    labels: ['integration', 'github', 'help wanted'],
    summary:
      'Accept GitHub webhook events, connect PRs to bounty records, and auto-transition reserved bounties into submitted state.',
    impact: 'advanced',
  },
  {
    id: 'SBB-103',
    title: 'Replace JSON persistence with Postgres and add an audit log table',
    labels: ['backend', 'database', 'help wanted'],
    summary:
      'Migrate from file storage to Postgres and preserve a complete history of status transitions for bounty payouts and refunds.',
    impact: 'core',
  },
  {
    id: 'SBB-104',
    title: 'Add a contributor profile page with claim history and earnings',
    labels: ['frontend', 'good first issue'],
    summary:
      'Show reserved, submitted, and released bounties per contributor with lifetime payout totals and filterable status chips.',
    impact: 'starter',
  },
];

export function listOpenIssues(): OpenIssue[] {
  return openIssues;
}
