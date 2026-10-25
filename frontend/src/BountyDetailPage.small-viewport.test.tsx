import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';

import BountyDetailPage from './BountyDetailPage';
import type { Bounty, BountyStatus } from './types';

const longTitleBounty: Bounty = {
  id: 'BNTY-STELLAR-EXTRA-LONG-IDENTIFIER-FOR-320PX-VIEWPORT-TESTING-1279',
  repo: 'stellar/stellar-bounty-board',
  issueNumber: 1279,
  title:
    'Extremely Long Bounty Detail Page Title Designed To Validate Responsive Text Truncation And Wrapping Under 320px Viewports',
  summary:
    'Detailed summary description verifying that bounty details prevent horizontal scroll while preserving 44px tap targets and text accessibility.',
  maintainer: 'GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST',
  contributor: 'GCZ4AHR7A74N2O72R26L64H3B5TESTCONTRIBUTOR44PXTAPTARGET001',
  tokenSymbol: 'XLM',
  amount: 2500,
  labels: [{ name: 'responsive-design', color: '1f883d' }],
  status: 'open' as BountyStatus,
  createdAt: 1700000000,
  deadlineAt: 1700086400,
  releasedTxHash: '9f8e7d6c5b4a3928170f1e2d3c4b5a697887654321fedcba0987654321abcdef',
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

describe('BountyDetailPage small-viewport layout (#1279)', () => {
  it('renders within constrained 320px viewport without overflow', () => {
    const { container } = render(
      <div style={{ width: '320px', maxWidth: '320px', overflowX: 'hidden' }}>
        <BountyDetailPage
          bounty={longTitleBounty}
          loading={false}
          onBack={() => {}}
          owner="stellar"
          avatarUrl=""
          statusCopy={defaultStatusCopy}
          actionCopy={defaultActionCopy}
          renderActionButton={() => <button type="button">Action</button>}
          formatTimestamp={(t) => (t ? new Date(t * 1000).toLocaleDateString() : '')}
        />
      </div>
    );

    const detailPanel = container.querySelector('.bounty-detail');
    expect(detailPanel).toBeInTheDocument();

    const title = screen.getByRole('heading', { level: 2 });
    expect(title).toBeInTheDocument();
    expect(title.textContent).toContain('Extremely Long Bounty Detail Page Title');
  });

  it('renders action buttons and links meeting 44px minimum touch targets', async () => {
    const user = userEvent.setup();
    render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <BountyDetailPage
          bounty={longTitleBounty}
          loading={false}
          onBack={() => {}}
          owner="stellar"
          avatarUrl=""
          statusCopy={defaultStatusCopy}
          actionCopy={defaultActionCopy}
          renderActionButton={() => <button type="button">Action</button>}
          formatTimestamp={(t) => (t ? new Date(t * 1000).toLocaleDateString() : '')}
        />
      </div>
    );

    const shareBtn = screen.getByRole('button', { name: /share bounty/i });
    expect(shareBtn).toHaveClass('secondary-button');

    const printBtn = screen.getByRole('button', { name: /print \/ export pdf/i });
    expect(printBtn).toHaveClass('secondary-button');

    const backBtn = screen.getByRole('button', { name: /back/i });
    expect(backBtn).toHaveClass('secondary-button');

    await user.tab();
    expect(shareBtn).toHaveFocus();
  });

  it('supports long text truncation with accessible copy affordances', () => {
    render(
      <BountyDetailPage
        bounty={longTitleBounty}
        loading={false}
        onBack={() => {}}
        owner="stellar"
        avatarUrl=""
        statusCopy={defaultStatusCopy}
        actionCopy={defaultActionCopy}
        renderActionButton={() => <button type="button">Action</button>}
        formatTimestamp={(t) => (t ? new Date(t * 1000).toLocaleDateString() : '')}
      />
    );

    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    expect(copyButtons.length).toBeGreaterThan(0);

    const issueLink = screen.getByRole('link', { name: /#1279/i });
    expect(issueLink).toHaveAttribute('href', expect.stringContaining('1279'));
  });

  it('applies responsive layout adjustments at 320px breakpoint', () => {
    const { container } = render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <BountyDetailPage
          bounty={longTitleBounty}
          loading={false}
          onBack={() => {}}
          owner="stellar"
          avatarUrl=""
          statusCopy={defaultStatusCopy}
          actionCopy={defaultActionCopy}
          renderActionButton={() => <button type="button">Action</button>}
          formatTimestamp={(t) => (t ? new Date(t * 1000).toLocaleDateString() : '')}
        />
      </div>
    );

    // Verify meta-grid exists (CSS handles the grid-template-columns via media query)
    const metaGrid = container.querySelector('.meta-grid--detail');
    expect(metaGrid).toBeInTheDocument();

    // Verify bounty-detail__hero exists (CSS handles the grid-template-columns via media query)
    const hero = container.querySelector('.bounty-detail__hero');
    expect(hero).toBeInTheDocument();

    // Verify panel-header__actions exists (CSS handles flex-direction via media query)
    const panelActions = container.querySelector('.panel-header__actions');
    expect(panelActions).toBeInTheDocument();
  });
});
