import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, it, expect, vi } from 'vitest';

import {
  type AsyncDataState,
  type Bounty,
  getAccessibleAsyncStateAnnouncement,
  isLoadingState,
  isErrorState,
  isEmptyState,
  isSuccessState,
} from './types';

const mockBounty: Bounty = {
  id: 'BNTY-TYPES-1',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 1300,
  title: 'Accessibility audit for types UI consumers',
  summary: 'Validates axe compliance and keyboard operability for async state rendering.',
  maintainer: 'GBBDQGY5X7DMNQC56QOD3B5XW3Y7VUP6YEX22CQQG2MNW6S2HBLVTEST',
  tokenSymbol: 'USDC',
  amount: 250,
  labels: [{ name: 'a11y', color: '0e8a16' }],
  status: 'open',
  createdAt: 1700000000,
  deadlineAt: 1700086400,
  version: 1,
  events: [],
};

interface AccessibleAsyncStateViewerProps<T extends { id: string; title: string }> {
  state: AsyncDataState<T[]>;
}

function AccessibleAsyncStateViewer<T extends { id: string; title: string }>({
  state,
}: AccessibleAsyncStateViewerProps<T>) {
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const announcement = getAccessibleAsyncStateAnnouncement(state, 'bounties');

  return (
    <main>
      <h1>Bounties Dashboard</h1>
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="async-live-region"
      >
        {announcement}
      </div>

      {isLoadingState(state) && (
        <section
          className="loading-state"
          role="status"
          aria-busy="true"
          data-testid="async-loading"
        >
          <p>Loading bounties...</p>
        </section>
      )}

      {isErrorState(state) && (
        <section className="error-state" role="alert" data-testid="async-error">
          <p>{state.error || 'Failed to load bounties.'}</p>
          {state.onRetry && (
            <button
              type="button"
              className="retry-button"
              onClick={state.onRetry}
              aria-label="Retry loading bounties"
            >
              Retry
            </button>
          )}
        </section>
      )}

      {isEmptyState(state) && (
        <section className="empty-state" role="status" data-testid="async-empty">
          <p>No bounties found.</p>
        </section>
      )}

      {isSuccessState(state) && (
        <section aria-label="Available bounties list">
          <ul data-testid="async-list">
            {state.data.map((item) => (
              <li key={item.id}>
                <span>{item.title}</span>
                <button
                  type="button"
                  onClick={() => setActiveItem(item.id)}
                  aria-pressed={activeItem === item.id}
                  aria-label={`Select bounty ${item.title}`}
                >
                  Select
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

describe('types.ts accessibility pass (#1300)', () => {
  it('has zero critical or serious axe violations across rendered states', async () => {
    // 1. Success state
    const successState: AsyncDataState<Bounty[]> = {
      status: 'success',
      data: [mockBounty],
    };
    const { container: successContainer } = render(
      <AccessibleAsyncStateViewer state={successState} />
    );
    let results = await axe(successContainer);
    expect(results).toHaveNoViolations();

    // 2. Loading state
    const loadingState: AsyncDataState<Bounty[]> = {
      status: 'loading',
    };
    const { container: loadingContainer } = render(
      <AccessibleAsyncStateViewer state={loadingState} />
    );
    results = await axe(loadingContainer);
    expect(results).toHaveNoViolations();

    // 3. Error state with retry
    const errorState: AsyncDataState<Bounty[]> = {
      status: 'error',
      error: 'Network connectivity timeout',
      onRetry: vi.fn(),
    };
    const { container: errorContainer } = render(
      <AccessibleAsyncStateViewer state={errorState} />
    );
    results = await axe(errorContainer);
    expect(results).toHaveNoViolations();

    // 4. Empty state
    const emptyState: AsyncDataState<Bounty[]> = {
      status: 'empty',
      data: [],
    };
    const { container: emptyContainer } = render(
      <AccessibleAsyncStateViewer state={emptyState} />
    );
    results = await axe(emptyContainer);
    expect(results).toHaveNoViolations();
  });

  it('supports full keyboard navigation and interaction', async () => {
    const user = userEvent.setup();
    const handleRetry = vi.fn();
    const errorState: AsyncDataState<Bounty[]> = {
      status: 'error',
      error: 'Unable to reach backend service',
      onRetry: handleRetry,
    };

    const { rerender } = render(<AccessibleAsyncStateViewer state={errorState} />);

    // Tab to retry button
    await user.tab();
    const retryBtn = screen.getByRole('button', { name: /retry loading bounties/i });
    expect(retryBtn).toHaveFocus();

    // Activate retry with keyboard
    await user.keyboard('{Enter}');
    expect(handleRetry).toHaveBeenCalledTimes(1);

    // Rerender as success with interactive items
    const successState: AsyncDataState<Bounty[]> = {
      status: 'success',
      data: [mockBounty],
    };
    rerender(<AccessibleAsyncStateViewer state={successState} />);

    // Tab to item button
    await user.tab();
    const selectBtn = screen.getByRole('button', {
      name: `Select bounty ${mockBounty.title}`,
    });
    expect(selectBtn).toHaveFocus();

    // Activate item with keyboard
    await user.keyboard('{Space}');
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('generates accurate accessible announcements for screen readers', () => {
    expect(getAccessibleAsyncStateAnnouncement({ status: 'loading' }, 'bounties')).toBe(
      'Loading bounties...'
    );
    expect(
      getAccessibleAsyncStateAnnouncement(
        { status: 'error', error: 'Network unavailable' },
        'bounties'
      )
    ).toBe('Error loading bounties: Network unavailable.');
    expect(getAccessibleAsyncStateAnnouncement({ status: 'empty', data: [] }, 'bounties')).toBe(
      'No bounties found.'
    );
    expect(
      getAccessibleAsyncStateAnnouncement(
        { status: 'success', data: [mockBounty, { ...mockBounty, id: 'BNTY-2' }] },
        'bounties'
      )
    ).toBe('Successfully loaded 2 bounties.');
  });
});
