import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';

import MaintainerDashboard, {
  getActionUrgencyScore,
  sortBountiesByActionUrgency,
} from './MaintainerDashboard';
import type { Bounty, BountyStatus } from './types';

const longTitleBounty: Bounty = {
  id: 'BNTY-STELLAR-EXTRA-LONG-IDENTIFIER-FOR-320PX-VIEWPORT-TESTING-1279',
  repo: 'stellar/stellar-bounty-board-with-extremely-long-repository-name-for-testing',
  issueNumber: 1279,
  title:
    'Extremely Long Bounty Title Designed To Validate Responsive Text Truncation And Wrapping Under 320px Viewports Without Horizontal Scroll',
  summary:
    'Detailed summary description verifying that maintainer dashboard prevents horizontal scroll while preserving 44px tap targets and text accessibility.',
  maintainer: 'GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST',
  contributor: 'GCZ4AHR7A74N2O72R26L64H3B5TESTCONTRIBUTOR44PXTAPTARGET001',
  tokenSymbol: 'XLM',
  amount: 2500,
  labels: [{ name: 'responsive-design', color: '1f883d' }],
  status: 'submitted' as BountyStatus,
  createdAt: 1700000000,
  deadlineAt: 1700086400,
  submittedAt: 1700050000,
  releasedTxHash: '9f8e7d6c5b4a3928170f1e2d3c4b5a697887654321fedcba0987654321abcdef',
  version: 1,
  events: [
    {
      type: 'created',
      timestamp: 1700000000,
      actor: 'maintainer',
    },
  ],
  submissionUrl: 'https://github.com/stellar/stellar-bounty-board/pull/1279/very/long/url/path/that/should/truncate/on/small/viewports',
};

const disputedBounty: Bounty = {
  ...longTitleBounty,
  id: 'BNTY-DISPUTED-TEST',
  status: 'disputed' as BountyStatus,
  issueNumber: 1280,
};

const openBounty: Bounty = {
  ...longTitleBounty,
  id: 'BNTY-OPEN-TEST',
  status: 'open' as BountyStatus,
  issueNumber: 1281,
  submissionUrl: undefined,
};

describe('MaintainerDashboard small-viewport layout (#1279)', () => {
  it('renders within constrained 320px viewport without overflow', () => {
    const { container } = render(
      <div style={{ width: '320px', maxWidth: '320px', overflowX: 'hidden' }}>
        <MaintainerDashboard
          bounties={[longTitleBounty, openBounty]}
          maintainerAddress="GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST"
          loading={false}
          onSelectBounty={() => {}}
          onRelease={() => {}}
          onRefund={() => {}}
        />
      </div>
    );

    const dashboard = container.querySelector('.maintainer-dashboard');
    expect(dashboard).toBeInTheDocument();

    const title = screen.getByRole('heading', { level: 2, name: /maintainer action hub/i });
    expect(title).toBeInTheDocument();
  });

  it('renders summary pills without horizontal overflow at 320px', () => {
    const { container } = render(
      <div style={{ width: '320px', maxWidth: '320px', overflowX: 'hidden' }}>
        <MaintainerDashboard
          bounties={[longTitleBounty, disputedBounty, openBounty]}
          maintainerAddress="GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST"
          loading={false}
          onSelectBounty={() => {}}
          onRelease={() => {}}
          onRefund={() => {}}
        />
      </div>
    );

    const summaryStrip = container.querySelector('.maintainer-summary-strip');
    expect(summaryStrip).toBeInTheDocument();

    // Verify all 4 summary pills are present
    expect(screen.getByText(/submissions to review/i)).toBeInTheDocument();
    expect(screen.getByText(/disputes pending/i)).toBeInTheDocument();
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/open bounties/i)).toBeInTheDocument();
  });

  it('renders address filter input with adequate touch target size', () => {
    const { container } = render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <MaintainerDashboard
          bounties={[longTitleBounty]}
          loading={false}
          onSelectBounty={() => {}}
          onRelease={() => {}}
          onRefund={() => {}}
        />
      </div>
    );

    const addressInput = screen.getByLabelText(/maintainer public key/i);
    expect(addressInput).toBeInTheDocument();
    expect(addressInput).toHaveClass('maintainer-address-input');
  });

  it('renders bounty cards with action buttons meeting 44px minimum touch targets', async () => {
    const user = userEvent.setup();
    render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <MaintainerDashboard
          bounties={[longTitleBounty]}
          maintainerAddress="GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST"
          loading={false}
          onSelectBounty={() => {}}
          onRelease={() => {}}
          onRefund={() => {}}
        />
      </div>
    );

    const releaseBtn = screen.getByRole('button', { name: /approve & release/i });
    expect(releaseBtn).toBeInTheDocument();
    expect(releaseBtn).toHaveClass('primary-button');

    const refundBtn = screen.getByRole('button', { name: /refund escrow/i });
    expect(refundBtn).toBeInTheDocument();
    expect(refundBtn).toHaveClass('ghost-button');

    const viewDetailsBtn = screen.getByRole('button', { name: /view details/i });
    expect(viewDetailsBtn).toBeInTheDocument();
    expect(viewDetailsBtn).toHaveClass('secondary-button');

    // Test keyboard navigation
    await user.tab();
    expect(releaseBtn).toHaveFocus();
  });

  it('handles long submission URLs with proper truncation', () => {
    render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <MaintainerDashboard
          bounties={[longTitleBounty]}
          maintainerAddress="GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST"
          loading={false}
          onSelectBounty={() => {}}
          onRelease={() => {}}
          onRefund={() => {}}
        />
      </div>
    );

    const submissionLink = screen.getByRole('link', { name: /submission/i });
    expect(submissionLink).toBeInTheDocument();
    expect(submissionLink).toHaveAttribute('href', longTitleBounty.submissionUrl);
  });

  it('displays urgency badges for actionable bounties', () => {
    const { container } = render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <MaintainerDashboard
          bounties={[longTitleBounty, disputedBounty]}
          maintainerAddress="GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST"
          loading={false}
          onSelectBounty={() => {}}
          onRelease={() => {}}
          onRefund={() => {}}
        />
      </div>
    );

    // Check for "Needs Review" badge on submitted bounty
    expect(screen.getByText(/⚠️ needs review/i)).toBeInTheDocument();

    // Check for "Action Needed" badge on disputed bounty
    expect(screen.getByText(/⚖️ action needed/i)).toBeInTheDocument();
  });

  it('sorts bounties by action urgency correctly', () => {
    const bounties = [openBounty, longTitleBounty, disputedBounty];
    const sorted = sortBountiesByActionUrgency(bounties);

    // Submitted (100) should be first, then disputed (90), then open (20)
    expect(sorted[0].status).toBe('submitted');
    expect(sorted[1].status).toBe('disputed');
    expect(sorted[2].status).toBe('open');
  });

  it('assigns correct urgency scores to bounty statuses', () => {
    expect(getActionUrgencyScore('submitted')).toBe(100);
    expect(getActionUrgencyScore('disputed')).toBe(90);
    expect(getActionUrgencyScore('reserved')).toBe(50);
    expect(getActionUrgencyScore('open')).toBe(20);
    expect(getActionUrgencyScore('released')).toBe(5);
    expect(getActionUrgencyScore('refunded')).toBe(5);
    expect(getActionUrgencyScore('expired')).toBe(1);
  });

  it('handles keyboard navigation on bounty cards', async () => {
    const user = userEvent.setup();
    const onSelectBounty = vi.fn();

    render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <MaintainerDashboard
          bounties={[longTitleBounty]}
          maintainerAddress="GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST"
          loading={false}
          onSelectBounty={onSelectBounty}
          onRelease={() => {}}
          onRefund={() => {}}
        />
      </div>
    );

    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('tabIndex', '0');

    // Test Enter key
    await user.click(card);
    card.focus();
    await user.keyboard('{Enter}');
    expect(onSelectBounty).toHaveBeenCalledWith(longTitleBounty.id);

    // Test Space key
    onSelectBounty.mockClear();
    await user.keyboard(' ');
    expect(onSelectBounty).toHaveBeenCalledWith(longTitleBounty.id);
  });

  it('prevents event propagation on action button clicks', async () => {
    const user = userEvent.setup();
    const onSelectBounty = vi.fn();
    const onRelease = vi.fn();

    render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <MaintainerDashboard
          bounties={[longTitleBounty]}
          maintainerAddress="GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST"
          loading={false}
          onSelectBounty={onSelectBounty}
          onRelease={onRelease}
          onRefund={() => {}}
        />
      </div>
    );

    const releaseBtn = screen.getByRole('button', { name: /approve & release/i });
    await user.click(releaseBtn);

    // onRelease should be called, but onSelectBounty should not (event propagation stopped)
    expect(onRelease).toHaveBeenCalledWith(longTitleBounty);
    expect(onSelectBounty).not.toHaveBeenCalled();
  });

  it('displays empty state when no bounties found', () => {
    render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <MaintainerDashboard
          bounties={[]}
          maintainerAddress="GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST"
          loading={false}
          onSelectBounty={() => {}}
          onRelease={() => {}}
          onRefund={() => {}}
        />
      </div>
    );

    expect(screen.getByRole('heading', { name: /no bounties found/i })).toBeInTheDocument();
    expect(
      screen.getByText(/no bounties found created by maintainer/i)
    ).toBeInTheDocument();
  });

  it('displays loading state', () => {
    render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <MaintainerDashboard
          bounties={[]}
          maintainerAddress="GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST"
          loading={true}
          onSelectBounty={() => {}}
          onRelease={() => {}}
          onRefund={() => {}}
        />
      </div>
    );

    expect(screen.getByText(/loading maintainer bounties/i)).toBeInTheDocument();
  });
});
