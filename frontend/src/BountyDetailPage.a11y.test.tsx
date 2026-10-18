import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, it, expect } from 'vitest';

import BountyDetailPage, { getAccessibleBountyDetailLabel } from './BountyDetailPage';
import type { Bounty, BountyStatus } from './types';

const mockBounty: Bounty = {
  id: 'BNTY-A11Y-1278',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 1278,
  title: 'Accessibility verification for bounty detail screen',
  summary: 'Ensures zero axe violations and robust keyboard navigation.',
  maintainer: 'GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST',
  contributor: 'GCZ4AHR7A74N2O72R26L64H3B5TESTCONTRIBUTOR44PXTAPTARGET001',
  tokenSymbol: 'USDC',
  amount: 500,
  labels: [{ name: 'accessibility', color: '0e8a16' }],
  status: 'open' as BountyStatus,
  createdAt: 1700000000,
  deadlineAt: 1700086400,
  submissionUrl: 'https://github.com/ritik4ever/stellar-bounty-board/pull/1645',
  version: 1,
  events: [
    {
      type: 'created',
      timestamp: 1700000000,
      actor: 'maintainer',
    },
  ],
};

const defaultStatusCopy: Record<BountyStatus, { label: string; description: string }> = {
  open: { label: 'Open', description: 'Available for work' },
  reserved: { label: 'Reserved', description: 'Claimed by contributor' },
  submitted: { label: 'Submitted', description: 'Work submitted for review' },
  released: { label: 'Released', description: 'Payment disbursed' },
  refunded: { label: 'Refunded', description: 'Funds returned to creator' },
  disputed: { label: 'Disputed', description: 'Under arbitration' },
};

const defaultActionCopy = {
  open: [{ action: 'reserve' as const, label: 'Reserve', title: 'Reserve this bounty' }],
  reserved: [{ action: 'submit' as const, label: 'Submit Work', title: 'Submit work for review' }],
  submitted: [
    { action: 'release' as const, label: 'Release Payment', title: 'Release bounty funds' },
  ],
  released: [],
  refunded: [],
  disputed: [],
};

describe('BountyDetailPage accessibility pass (#1278)', () => {
  it('has zero critical or serious axe violations on rendered detail page', async () => {
    const { container } = render(
      <main>
        <BountyDetailPage
          bounty={mockBounty}
          loading={false}
          onBack={() => {}}
          owner="ritik4ever"
          avatarUrl="https://avatars.githubusercontent.com/u/1"
          statusCopy={defaultStatusCopy}
          actionCopy={defaultActionCopy}
          renderActionButton={(b, a) => (
            <button key={a.action} type="button">
              {a.label}
            </button>
          )}
          formatTimestamp={(t) => (t ? new Date(t * 1000).toLocaleDateString() : '')}
        />
      </main>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports full keyboard navigation through header buttons and interactive links', async () => {
    const user = userEvent.setup();
    render(
      <main>
        <BountyDetailPage
          bounty={mockBounty}
          loading={false}
          onBack={() => {}}
          owner="ritik4ever"
          avatarUrl=""
          statusCopy={defaultStatusCopy}
          actionCopy={defaultActionCopy}
          renderActionButton={() => <button type="button">Action</button>}
          formatTimestamp={(t) => (t ? new Date(t * 1000).toLocaleDateString() : '')}
        />
      </main>
    );

    // Tab into Share button
    await user.tab();
    const shareBtn = screen.getByRole('button', { name: /share bounty/i });
    expect(shareBtn).toHaveFocus();

    // Tab into Print button
    await user.tab();
    const printBtn = screen.getByRole('button', { name: /print or export pdf/i });
    expect(printBtn).toHaveFocus();

    // Tab into Back button
    await user.tab();
    const backBtn = screen.getByRole('button', { name: /go back to bounties list/i });
    expect(backBtn).toHaveFocus();
  });

  it('provides accessible bounty detail label helper', () => {
    const label = getAccessibleBountyDetailLabel(mockBounty);
    expect(label).toContain('Bounty #1278');
    expect(label).toContain('500 USDC');
    expect(label).toContain('status open');
  });
});
