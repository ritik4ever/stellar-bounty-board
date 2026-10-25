/**
 * Accessibility tests for the UI driven by api.ts responses.
 *
 * api.ts itself is a pure HTTP-client module (no JSX), so its a11y surface
 * is exercised through the components that render its data.  The primary
 * interactive element is BountyCard, which is produced from every
 * listBounties / getBounty response.
 *
 * Acceptance criteria:
 *   ✓ Zero critical/serious axe violations in all API-driven render states
 *   ✓ Keyboard-only operation works end to end (focus, Enter, Space, Tab)
 *   ✓ Automated axe assertion present so regressions are caught
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BountyCard from './BountyCard';
import type { Bounty } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: 'BNTY-A11Y-001',
    repo: 'stellar-org/stellar-bounty-board',
    issueNumber: 42,
    title: 'Accessible bounty card rendered from api.ts data',
    summary: 'Verifies that api.ts response shapes produce accessible markup.',
    maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    tokenSymbol: 'XLM',
    amount: 200,
    labels: [
      { name: 'accessibility', color: '0e8a16' },
      { name: 'good first issue', color: 'ee9900' },
    ],
    status: 'open',
    createdAt: 1_700_000_000,
    deadlineAt: 9_999_999_999,
    version: 1,
    events: [],
    ...overrides,
  };
}

/** Minimal renderActionButton satisfying the render-prop contract. */
function renderActionButton(
  _bounty: Bounty,
  action: { action: string; label: string; title: string }
) {
  return (
    <button key={action.action} type="button" title={action.title}>
      {action.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // BountyAmount uses xlmToUsd which may call fetch — stub it out.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ USD: 0.12 }),
      headers: { get: () => 'application/json' },
    })
  );

  // jsdom does not implement IntersectionObserver; provide a no-op stub so
  // BountyCard's scroll sentinel effect does not throw.
  if (typeof window.IntersectionObserver === 'undefined') {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  }
});

// ---------------------------------------------------------------------------
// 1. Axe — zero violations across all status variants
// ---------------------------------------------------------------------------

describe('api.ts – BountyCard axe audit (all status variants)', () => {
  const statuses: Bounty['status'][] = [
    'open',
    'reserved',
    'submitted',
    'released',
    'refunded',
    'disputed',
  ];

  for (const status of statuses) {
    it(`has zero axe violations for status="${status}"`, async () => {
      const bounty = makeBounty({ status, contributor: status !== 'open' ? 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBTEST' : undefined });

      const { container } = render(
        <main>
          <ul role="list">
            <li>
              <BountyCard
                bounty={bounty}
                onOpen={vi.fn()}
                renderActionButton={renderActionButton}
              />
            </li>
          </ul>
        </main>
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Axe — multi-select (checkbox) variant
// ---------------------------------------------------------------------------

describe('api.ts – BountyCard multi-select axe audit', () => {
  it('has zero axe violations when selection prop is provided', async () => {
    const bounty = makeBounty();
    const { container } = render(
      <main>
        <ul role="list">
          <li>
            <BountyCard
              bounty={bounty}
              onOpen={vi.fn()}
              renderActionButton={renderActionButton}
              selection={{ selected: false, onToggle: vi.fn() }}
            />
          </li>
        </ul>
      </main>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has zero axe violations when a card is checked (selected=true)', async () => {
    const bounty = makeBounty();
    const { container } = render(
      <main>
        <ul role="list">
          <li>
            <BountyCard
              bounty={bounty}
              onOpen={vi.fn()}
              renderActionButton={renderActionButton}
              selection={{ selected: true, onToggle: vi.fn() }}
            />
          </li>
        </ul>
      </main>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// 3. Axe — loading-more indicator
// ---------------------------------------------------------------------------

describe('api.ts – BountyCard loading-more state axe audit', () => {
  it('has zero axe violations while more data is being fetched (isLoadingMore=true)', async () => {
    const bounty = makeBounty();
    const { container } = render(
      <main>
        <ul role="list">
          <li>
            <BountyCard
              bounty={bounty}
              onOpen={vi.fn()}
              renderActionButton={renderActionButton}
              isLast={true}
              hasMore={true}
              isLoadingMore={true}
              onLoadMore={vi.fn()}
            />
          </li>
        </ul>
      </main>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// 4. Axe — list of multiple cards (realistic api.ts listBounties response)
// ---------------------------------------------------------------------------

describe('api.ts – multi-card list axe audit', () => {
  it('has zero axe violations when rendering a full page of bounty cards', async () => {
    const bounties = [
      makeBounty({ id: 'BNTY-001', title: 'Fix XLM fee calculation', status: 'open' }),
      makeBounty({ id: 'BNTY-002', title: 'Add CSV export endpoint', status: 'reserved', contributor: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCTEST' }),
      makeBounty({ id: 'BNTY-003', title: 'Improve error messages', status: 'submitted', contributor: 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDTEST' }),
    ];

    const { container } = render(
      <main>
        <ul role="list">
          {bounties.map((b) => (
            <li key={b.id}>
              <BountyCard
                bounty={b}
                onOpen={vi.fn()}
                renderActionButton={renderActionButton}
              />
            </li>
          ))}
        </ul>
      </main>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// 5. Keyboard operability — card focus and activation
// ---------------------------------------------------------------------------

describe('api.ts – BountyCard keyboard operability', () => {
  it('card receives focus via Tab and can be activated with Enter', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const bounty = makeBounty();

    render(
      <main>
        <BountyCard bounty={bounty} onOpen={onOpen} renderActionButton={renderActionButton} />
      </main>
    );

    const card = screen.getByRole('article');
    // Tab into the card
    await user.tab();
    expect(card).toHaveFocus();

    // Enter activates the card
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith('BNTY-A11Y-001');
  });

  it('card can be activated with Space', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const bounty = makeBounty();

    render(
      <main>
        <BountyCard bounty={bounty} onOpen={onOpen} renderActionButton={renderActionButton} />
      </main>
    );

    const card = screen.getByRole('article');
    await user.tab();
    expect(card).toHaveFocus();

    await user.keyboard(' ');
    expect(onOpen).toHaveBeenCalledWith('BNTY-A11Y-001');
  });

  it('Tab moves focus through nested interactive elements without triggering card open', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const bounty = makeBounty({ status: 'open' });

    render(
      <main>
        <BountyCard bounty={bounty} onOpen={onOpen} renderActionButton={renderActionButton} />
      </main>
    );

    // Tab 1 → card article
    await user.tab();
    expect(screen.getByRole('article')).toHaveFocus();

    // Tab 2 → GitHub issue link
    await user.tab();
    const issueLink = screen.getByRole('link', {
      name: /stellar-org\/stellar-bounty-board\s*#42/i,
    });
    expect(issueLink).toHaveFocus();

    // Tab 3 → "Reserve" action button
    await user.tab();
    const reserveBtn = screen.getByRole('button', { name: /reserve/i });
    expect(reserveBtn).toHaveFocus();

    // Card-open callback must NOT have fired during these Tab keypresses
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('Enter on an inner action button does not propagate to open the card', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onReserve = vi.fn();

    const bounty = makeBounty({ status: 'open' });

    render(
      <main>
        <BountyCard
          bounty={bounty}
          onOpen={onOpen}
          renderActionButton={(_b, action) => (
            <button key={action.action} type="button" onClick={onReserve}>
              {action.label}
            </button>
          )}
        />
      </main>
    );

    // Focus directly on the Reserve button and press Enter
    const reserveBtn = screen.getByRole('button', { name: /reserve/i });
    reserveBtn.focus();
    await user.keyboard('{Enter}');

    expect(onReserve).toHaveBeenCalledOnce();
    // Card-open should NOT fire — the event must be stopped at the button
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('multi-select checkbox is keyboard-operable and does not open the card', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const bounty = makeBounty();

    render(
      <main>
        <BountyCard
          bounty={bounty}
          onOpen={onOpen}
          renderActionButton={renderActionButton}
          selection={{ selected: false, onToggle }}
        />
      </main>
    );

    const checkbox = screen.getByRole('checkbox', {
      name: /select BNTY-A11Y-001 for bulk action/i,
    });
    checkbox.focus();
    await user.keyboard(' ');

    expect(onToggle).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Accessible name — card aria-label reflects api.ts data
// ---------------------------------------------------------------------------

describe('api.ts – BountyCard accessible name', () => {
  it('article has an aria-label containing the bounty title', () => {
    const bounty = makeBounty({ title: 'My unique api-driven bounty title' });

    render(
      <BountyCard bounty={bounty} onOpen={vi.fn()} renderActionButton={renderActionButton} />
    );

    const card = screen.getByRole('article', {
      name: /my unique api-driven bounty title/i,
    });
    expect(card).toBeDefined();
  });

  it('status pill has an accessible label describing status + description', () => {
    const bounty = makeBounty({ status: 'reserved', contributor: 'GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEETEST' });

    render(
      <BountyCard bounty={bounty} onOpen={vi.fn()} renderActionButton={renderActionButton} />
    );

    const pill = screen.getByTestId('bounty-card-status-pill');
    const label = pill.getAttribute('aria-label') ?? '';
    expect(label.toLowerCase()).toContain('reserved');
  });

  it('multi-select checkbox aria-label identifies the specific bounty id', () => {
    const bounty = makeBounty({ id: 'BNTY-BULK-007' });

    render(
      <BountyCard
        bounty={bounty}
        onOpen={vi.fn()}
        renderActionButton={renderActionButton}
        selection={{ selected: false, onToggle: vi.fn() }}
      />
    );

    expect(
      screen.getByRole('checkbox', { name: /select BNTY-BULK-007 for bulk action/i })
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Loading-more live region announced to assistive technology
// ---------------------------------------------------------------------------

describe('api.ts – pagination live region', () => {
  it('loading-more indicator has role="status" so screen readers announce it', () => {
    const bounty = makeBounty();

    render(
      <BountyCard
        bounty={bounty}
        onOpen={vi.fn()}
        renderActionButton={renderActionButton}
        isLast={true}
        hasMore={true}
        isLoadingMore={true}
        onLoadMore={vi.fn()}
      />
    );

    const status = screen.getByRole('status');
    expect(status).toBeDefined();
    expect(status.textContent).toMatch(/loading more/i);
  });

  it('loading-more spinner is hidden from assistive technology (aria-hidden)', () => {
    const bounty = makeBounty();

    render(
      <BountyCard
        bounty={bounty}
        onOpen={vi.fn()}
        renderActionButton={renderActionButton}
        isLast={true}
        hasMore={true}
        isLoadingMore={true}
        onLoadMore={vi.fn()}
      />
    );

    // The spinner element should be decorative only
    const spinner = document.querySelector('.spinner');
    expect(spinner).not.toBeNull();
    expect(spinner!.getAttribute('aria-hidden')).toBe('true');
  });
});
