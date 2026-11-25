import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import BountyCard from './BountyCard';
import type { Bounty, BountyStatus } from './types';

/**
 * Bounty fixture deliberately stresses small-viewport concerns (#1272):
 * a long title/summary that must wrap rather than overflow, and full-length
 * Stellar public keys that are truncated in the card meta.
 */
const longBounty: Bounty = {
  id: 'BNTY-STELLAR-EXTRA-LONG-IDENTIFIER-FOR-320PX-VIEWPORT-TESTING-1272',
  repo: 'stellar/stellar-bounty-board',
  issueNumber: 1272,
  title:
    'Extremely Long Bounty Card Title Designed To Validate Responsive Text Wrapping Under 320px Viewports',
  summary:
    'Detailed bounty summary verifying that the bounty card prevents horizontal scroll while preserving 44px tap targets and text accessibility at phone width.',
  maintainer: 'GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST',
  contributor: 'GCZ4AHR7A74N2O72R26L64H3B5TESTCONTRIBUTOR44PXTAPTARGET001',
  tokenSymbol: 'XLM',
  amount: 2500,
  labels: [{ name: 'responsive-design', color: '1f883d' }],
  status: 'open' as BountyStatus,
  createdAt: 1700000000,
  deadlineAt: 1700086400,
  version: 1,
  events: [{ type: 'created', timestamp: 1700000000, actor: 'maintainer' }],
};

/** Mirrors the production renderActionButton in App.tsx so the card renders the
 *  same button classes the <480px responsive pass (#1295) sizes to 44px. */
function renderActionButton(
  _bounty: Bounty,
  action: { action: 'reserve' | 'submit' | 'release' | 'refund'; label: string; title: string }
) {
  return (
    <button
      key={action.action}
      type="button"
      className={action.action === 'refund' ? 'ghost-button' : 'secondary-button'}
      data-testid={`action-button-${action.action}`}
      title={action.title}
    >
      {action.label}
    </button>
  );
}

describe('BountyCard small-viewport layout (#1272)', () => {
  // jsdom does not run a layout engine or evaluate CSS media queries, so these
  // tests assert the structure and the class/attribute hooks that the
  // <480px / 320px responsive pass (#1295) turns into real layout — the same
  // convention used by BountyDetailPage.small-viewport.test.tsx.

  it('renders within a constrained 320px viewport without losing structure', () => {
    const { container } = render(
      <div style={{ width: '320px', maxWidth: '320px', overflowX: 'hidden' }}>
        <BountyCard bounty={longBounty} onOpen={() => {}} renderActionButton={renderActionButton} />
      </div>
    );

    // The card itself is the unit the #1295 pass constrains to max-width: 100%.
    const card = container.querySelector('.bounty-card');
    expect(card).toBeInTheDocument();

    // Long title and summary render in full (they wrap rather than overflow).
    const title = screen.getByRole('heading', { level: 3 });
    expect(title).toBeInTheDocument();
    expect(title.textContent).toContain('Extremely Long Bounty Card Title');

    expect(screen.getByText(/Detailed bounty summary/)).toBeInTheDocument();

    // Layout regions the responsive pass targets remain present.
    expect(container.querySelector('.meta-grid')).toBeInTheDocument();
    expect(container.querySelector('.chip-row')).toBeInTheDocument();
    expect(container.querySelector('.action-row')).toBeInTheDocument();
  });

  it('renders action buttons using the 44px-minimum touch-target class', () => {
    render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <BountyCard bounty={longBounty} onOpen={() => {}} renderActionButton={renderActionButton} />
      </div>
    );

    // 'open' status exposes a Reserve action; production styles it as
    // secondary-button, which the #1295 pass sizes to a 44px minimum.
    const reserveButton = screen.getByTestId('action-button-reserve');
    expect(reserveButton).toHaveClass('secondary-button');
    expect(reserveButton).not.toBeDisabled();
    // The button stays in the keyboard tab sequence so the 44px target is
    // reachable, not just visually sized.
    expect(reserveButton).not.toHaveAttribute('tabindex', '-1');
  });

  it('truncates addresses while exposing the full value on demand', () => {
    render(
      <BountyCard bounty={longBounty} onOpen={() => {}} renderActionButton={renderActionButton} />
    );

    const maintainerEl = screen.getByTitle(longBounty.maintainer);
    const contributorEl = screen.getByTitle(longBounty.contributor as string);

    // Display form is the truncated short address…
    const shortMaintainer = `${longBounty.maintainer.slice(0, 6)}...${longBounty.maintainer.slice(-4)}`;
    const shortContributor = `${longBounty.contributor!.slice(0, 6)}...${longBounty.contributor!.slice(-4)}`;
    expect(maintainerEl.textContent).toBe(shortMaintainer);
    expect(contributorEl.textContent).toBe(shortContributor);

    // …and the full address is available via the title affordance.
    expect(maintainerEl).toHaveAttribute('title', longBounty.maintainer);
    expect(contributorEl).toHaveAttribute('title', longBounty.contributor as string);
  });
});
