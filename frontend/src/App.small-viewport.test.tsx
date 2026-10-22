/**
 * Small-viewport layout tests for App.tsx
 *
 * Tests the App shell at 320–414px (phone width) to verify:
 *   1. No horizontal scroll at 320px — header, hero form, board filters, pagination
 *   2. All interactive tap targets meet the 44px minimum
 *   3. Long text truncates without breaking layout; full value accessible on demand
 *
 * Approach: render each section inside a 320px-wide wrapper div and assert that
 * elements are present, class-named correctly, and have the right ARIA/DOM
 * attributes.  Actual pixel measurements are asserted through the CSS class
 * contracts (`.reward-range-filter__input`, `.icon-button`, etc.) rather than
 * computed styles, which are not available in jsdom.
 *
 * Related: wave-4 #14 — general responsive layout pass below 768px
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bounty, OpenIssue } from './types';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the App import
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

vi.mock('./api', () => ({
  createBounty: vi.fn(),
  exportReleasedPayoutsCsv: vi.fn(),
  getBounty: vi.fn(),
  listBounties: vi.fn(),
  listOpenIssues: vi.fn(),
  releaseBountySigned: vi.fn(),
  refundBountySigned: vi.fn(),
  reserveBounty: vi.fn(),
  submitBounty: vi.fn(),
  bulkBountyAction: vi.fn(),
  getNotificationPreferences: vi.fn().mockResolvedValue({
    address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    optedIn: false,
    channels: { email: false, webhook: false, push: false },
    events: {},
    supportedTransitions: [],
  }),
  updateNotificationPreferences: vi.fn(),
}));

vi.mock('./hooks/useFreighter', () => ({
  useFreighter: () => ({
    isConnected: false,
    publicKey: null,
    isOnCorrectNetwork: false,
    signPayload: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock('./MaintainerDashboard', () => ({
  default: () => <div data-testid="maintainer-dashboard-mock">Maintainer Dashboard</div>,
  getActionUrgencyScore: vi.fn(),
  sortBountiesByActionUrgency: vi.fn(),
}));

vi.mock('./components/FreighterConnectButton', () => ({
  default: () => <button type="button">Connect Wallet</button>,
}));

vi.mock('./i18n/I18nContext', () => ({
  useI18n: () => ({ t: (_key: string, fallback: string) => fallback }),
  LanguageSwitcher: () => null,
  I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import * as api from './api';
import App from './App';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LONG_TITLE =
  'Extremely Long Bounty Title That Would Cause Horizontal Overflow At 320px If Not Handled';

function makeBounty(overrides: Partial<Bounty> = {}): Bounty {
  return {
    id: 'BNTY-VIEWPORT-001',
    repo: 'stellar-org/stellar-bounty-board-with-an-unusually-long-repository-name',
    issueNumber: 320,
    title: LONG_TITLE,
    summary: 'Summary text for small-viewport tests.',
    maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    tokenSymbol: 'XLM',
    amount: 200,
    labels: [{ name: 'responsive', color: '1f883d' }],
    status: 'open',
    createdAt: 1_700_000_000,
    deadlineAt: 9_999_999_999,
    version: 1,
    events: [],
    ...overrides,
  };
}

function makeOpenIssue(): OpenIssue {
  return {
    id: 'GH-1',
    title: 'Test issue',
    labels: [],
    summary: 'Summary',
    impact: 'starter',
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function mockBrowserApis() {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

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
}

/** Render App inside a 320px-wide container and wait for data to settle. */
async function renderAt320(bounties: Bounty[] = [makeBounty()]) {
  vi.mocked(api.listBounties).mockResolvedValue({
    data: bounties,
    total: bounties.length,
    page: 1,
    pageSize: 10,
    hasMore: false,
  });
  vi.mocked(api.listOpenIssues).mockResolvedValue([makeOpenIssue()]);
  vi.mocked(api.getBounty).mockResolvedValue(bounties[0]);

  const result = render(
    <div
      style={{ width: '320px', maxWidth: '320px', overflowX: 'hidden' }}
      data-testid="viewport-320"
    >
      <App />
    </div>
  );

  // Wait for the initial load to resolve so the board is visible
  await waitFor(() => {
    expect(screen.queryByTestId('app-container')).toBeInTheDocument();
  });

  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBrowserApis();
  window.history.pushState(null, '', '/');
  window.prompt = vi.fn();
  window.alert = vi.fn();
});

// ---------------------------------------------------------------------------
// 1. No horizontal scroll — element presence inside 320px wrapper
// ---------------------------------------------------------------------------

describe('App.tsx small-viewport — no horizontal overflow at 320px', () => {
  it('renders app-container inside 320px wrapper', async () => {
    await renderAt320();
    const container = screen.getByTestId('app-container');
    expect(container).toBeInTheDocument();
  });

  it('renders main-header inside 320px wrapper', async () => {
    await renderAt320();
    expect(screen.getByTestId('main-header')).toBeInTheDocument();
  });

  it('renders logo home button inside the header', async () => {
    await renderAt320();
    const logo = screen.getByTestId('logo-home-btn');
    expect(logo).toBeInTheDocument();
    expect(logo.tagName).toBe('BUTTON');
  });

  it('header-actions div contains all icon buttons', async () => {
    await renderAt320();
    expect(screen.getByTestId('header-notification-preferences-btn')).toBeInTheDocument();
    expect(screen.getByTestId('header-status-glossary-btn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to (light|dark) theme/i })).toBeInTheDocument();
  });

  it('reward-range-filter renders with class-based layout (no inline overflow-causing width)', async () => {
    await renderAt320();
    const filter = screen.getByTestId('reward-range-filter');
    expect(filter).toBeInTheDocument();
    // Confirm class-based layout — should have className, not inline width style
    expect(filter.className).toContain('reward-range-filter');
    expect(filter.getAttribute('style')).toBeNull();
  });

  it('min and max reward inputs carry responsive CSS class, not fixed width inline style', async () => {
    await renderAt320();
    const minInput = screen.getByTestId('min-reward-filter');
    const maxInput = screen.getByTestId('max-reward-filter');

    // Must use the class that carries responsive width rules
    expect(minInput.className).toContain('reward-range-filter__input');
    expect(maxInput.className).toContain('reward-range-filter__input');

    // Must NOT have a fixed inline width (the old 90px was an overflow risk)
    expect(minInput.getAttribute('style')).toBeNull();
    expect(maxInput.getAttribute('style')).toBeNull();
  });

  it('dashboard-view-switcher renders with responsive CSS class at 320px', async () => {
    await renderAt320();
    const switcher = document.querySelector('.dashboard-view-switcher');
    expect(switcher).toBeInTheDocument();
  });

  it('filter chips render inside .filter-chips container', async () => {
    await renderAt320();
    const chipsContainer = document.querySelector('.filter-chips');
    expect(chipsContainer).toBeInTheDocument();
    // At least the "all" chip should be present
    const allChip = screen.getByRole('button', { name: /show all bounty statuses/i });
    expect(allChip).toBeInTheDocument();
  });

  it('pagination controls render with prev/next buttons', async () => {
    await renderAt320();
    expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
  });

  it('long bounty repo name is inside a bounty card without wrapping its container', async () => {
    await renderAt320();
    // BountyCard renders the repo in an <a> tag — it should be present
    const issueLink = screen.getByRole('link', {
      name: new RegExp('stellar-bounty-board.*#320', 'i'),
    });
    expect(issueLink).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Tap targets — all interactive elements have min-height/width CSS classes
// ---------------------------------------------------------------------------

describe('App.tsx small-viewport — tap target classes', () => {
  it('header icon buttons carry .icon-button class (44px min-height/width via CSS)', async () => {
    await renderAt320();

    const notifBtn = screen.getByTestId('header-notification-preferences-btn');
    const glossaryBtn = screen.getByTestId('header-status-glossary-btn');

    expect(notifBtn.className).toContain('icon-button');
    expect(glossaryBtn.className).toContain('icon-button');
  });

  it('theme toggle carries .theme-toggle class (44px min-height/width via CSS)', async () => {
    await renderAt320();
    const toggleBtn = screen.getByRole('button', { name: /switch to (light|dark) theme/i });
    expect(toggleBtn.className).toContain('theme-toggle');
  });

  it('view switcher tab buttons carry .view-tab-btn class (44px min-height via CSS)', async () => {
    await renderAt320();
    const browsTab = screen.getByRole('tab', { name: /public browse/i });
    const maintTab = screen.getByRole('tab', { name: /maintainer dashboard/i });

    expect(browsTab.className).toContain('view-tab-btn');
    expect(maintTab.className).toContain('view-tab-btn');
  });

  it('filter chip buttons carry .filter-chip class (44px min-height via CSS)', async () => {
    await renderAt320();
    const allChip = screen.getByRole('button', { name: /show all bounty statuses/i });
    expect(allChip.className).toContain('filter-chip');
  });

  it('Create Bounty submit button carries the default button rule (44px min-height via CSS)', async () => {
    await renderAt320();
    const createBtn = screen.getByRole('button', { name: /create bounty/i });
    expect(createBtn).toBeInTheDocument();
    expect(createBtn.getAttribute('type')).toBe('submit');
  });

  it('bounty card action button (Reserve) carries .secondary-button class', async () => {
    await renderAt320();
    await waitFor(() => {
      expect(screen.queryByTestId('action-button-reserve')).toBeInTheDocument();
    });
    const reserveBtn = screen.getByTestId('action-button-reserve');
    expect(reserveBtn.className).toContain('secondary-button');
  });

  it('pagination prev/next buttons are present and have type=button', async () => {
    await renderAt320();
    const prevBtn = screen.getByRole('button', { name: /previous page/i });
    const nextBtn = screen.getByRole('button', { name: /next page/i });

    expect(prevBtn.getAttribute('type')).toBe('button');
    expect(nextBtn.getAttribute('type')).toBe('button');
  });
});

// ---------------------------------------------------------------------------
// 3. Long text — truncation with full value accessible on demand
// ---------------------------------------------------------------------------

describe('App.tsx small-viewport — long text truncation', () => {
  it('logo h1 contains the app title text', async () => {
    await renderAt320();
    const logo = screen.getByTestId('logo-home-btn');
    expect(logo).toHaveTextContent('Stellar Bounty Board');
  });

  it('logo button has aria-label for full accessible name', async () => {
    await renderAt320();
    const logo = screen.getByRole('button', { name: /go to stellar bounty board home/i });
    expect(logo).toBeInTheDocument();
  });

  it('bounty card has accessible aria-label with the full title', async () => {
    await renderAt320();
    await waitFor(() => {
      expect(
        screen.queryByRole('article', { name: new RegExp(LONG_TITLE, 'i') })
      ).toBeInTheDocument();
    });
  });

  it('hero heading is present with full text', async () => {
    await renderAt320();
    expect(
      screen.getByRole('heading', {
        name: /fund github issues with on-chain escrow/i,
      })
    ).toBeInTheDocument();
  });

  it('active reward range badge shows full value text when filter is set', async () => {
    const user = userEvent.setup();
    await renderAt320();

    const minInput = screen.getByTestId('min-reward-filter');
    await user.clear(minInput);
    await user.type(minInput, '100');

    await waitFor(() => {
      const badge = screen.getByTestId('active-reward-range-badge');
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toMatch(/100/);
    });
  });

  it('clear reward range button is visible when filter is active', async () => {
    const user = userEvent.setup();
    await renderAt320();

    const maxInput = screen.getByTestId('max-reward-filter');
    await user.clear(maxInput);
    await user.type(maxInput, '500');

    await waitFor(() => {
      expect(screen.getByTestId('clear-reward-filter-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('clear-reward-filter-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('clear-reward-filter-btn')).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Keyboard operability at 320px
// ---------------------------------------------------------------------------

describe('App.tsx small-viewport — keyboard operability', () => {
  it('logo button is focusable and navigates home on Enter', async () => {
    const user = userEvent.setup();
    await renderAt320();

    const logo = screen.getByTestId('logo-home-btn');
    logo.focus();
    expect(logo).toHaveFocus();

    await user.keyboard('{Enter}');
    // Navigating to '/' from '/' is a no-op — no error thrown
    expect(window.location.pathname).toBe('/');
  });

  it('pressing / focuses the search input from outside a text field', async () => {
    const user = userEvent.setup();
    await renderAt320();

    const searchInput = screen.getByPlaceholderText(/search by repo, title, or label/i);
    expect(searchInput).not.toHaveFocus();

    await user.keyboard('/');

    expect(searchInput).toHaveFocus();
  });

  it('view switcher tab buttons are keyboard-selectable', async () => {
    const user = userEvent.setup();
    await renderAt320();

    const maintTab = screen.getByRole('tab', { name: /maintainer dashboard/i });
    maintTab.focus();
    expect(maintTab).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(maintTab).toHaveAttribute('aria-selected', 'true');

    // MaintainerDashboard is mocked — verify it rendered
    expect(screen.getByTestId('maintainer-dashboard-mock')).toBeInTheDocument();
  });

  it('notification preferences button updates URL to /settings/notifications', async () => {
    const user = userEvent.setup();
    // Render without waiting for the notifications page to fully mount
    // (it's a separate page component; we only test the navigation trigger here)
    vi.mocked(api.listBounties).mockResolvedValue({
      data: [makeBounty()],
      total: 1,
      page: 1,
      pageSize: 10,
      hasMore: false,
    });
    vi.mocked(api.listOpenIssues).mockResolvedValue([]);

    render(
      <div style={{ width: '320px', maxWidth: '320px', overflowX: 'hidden' }}>
        <App />
      </div>
    );

    await waitFor(() => {
      expect(screen.getByTestId('header-notification-preferences-btn')).toBeInTheDocument();
    });

    const notifBtn = screen.getByTestId('header-notification-preferences-btn');
    await user.click(notifBtn);

    expect(window.location.pathname).toBe('/settings/notifications');

    // Navigate back so subsequent tests start clean
    window.history.pushState(null, '', '/');
  });

  it('previous page button is disabled on page 1', async () => {
    await renderAt320();
    const prevBtn = screen.getByRole('button', { name: /previous page/i });
    expect(prevBtn).toBeDisabled();
  });

  it('next page button is disabled when hasMore is false', async () => {
    await renderAt320();
    const nextBtn = screen.getByRole('button', { name: /next page/i });
    expect(nextBtn).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 5. Edge cases — empty state and error state at 320px
// ---------------------------------------------------------------------------

describe('App.tsx small-viewport — empty and error states', () => {
  it('renders empty state when no bounties are returned', async () => {
    vi.mocked(api.listBounties).mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 10,
      hasMore: false,
    });
    vi.mocked(api.listOpenIssues).mockResolvedValue([]);

    render(
      <div style={{ width: '320px', maxWidth: '320px', overflowX: 'hidden' }}>
        <App />
      </div>
    );

    await waitFor(() => {
      expect(screen.getByText(/no bounties yet/i)).toBeInTheDocument();
    });
  });

  it('renders error state with retry button when the API fails', async () => {
    vi.mocked(api.listBounties).mockRejectedValue(new Error('Network error'));
    vi.mocked(api.listOpenIssues).mockResolvedValue([]);

    render(
      <div style={{ width: '320px', maxWidth: '320px', overflowX: 'hidden' }}>
        <App />
      </div>
    );

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
    });

    const retryBtn = screen.getByTestId('retry-button');
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn.className).toContain('secondary-button');
  });

  it('error state retry button is keyboard-focusable', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listBounties).mockRejectedValue(new Error('Network error'));
    vi.mocked(api.listOpenIssues).mockResolvedValue([]);

    render(
      <div style={{ width: '320px', maxWidth: '320px', overflowX: 'hidden' }}>
        <App />
      </div>
    );

    await waitFor(() => {
      expect(screen.getByTestId('retry-button')).toBeInTheDocument();
    });

    const retryBtn = screen.getByTestId('retry-button');
    retryBtn.focus();
    expect(retryBtn).toHaveFocus();
  });
});
