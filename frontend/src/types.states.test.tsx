import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import {
  resolveAsyncState,
  resolveAsyncDataState,
  isLoadingState,
  isEmptyState,
  isErrorState,
  isSuccessState,
  type AsyncDataState,
  type Bounty,
} from './types';

function TypesAsyncDataConsumer<T extends { id: string; title: string }>({
  state,
}: {
  state: AsyncDataState<T[]>;
}) {
  if (isLoadingState(state)) {
    return (
      <div
        className="loading-state types-state--loading fetch-state--loading"
        role="status"
        aria-busy="true"
        data-testid="types-loading"
      >
        <p>Loading items...</p>
      </div>
    );
  }

  if (isErrorState(state)) {
    return (
      <div
        className="error-state types-state--error fetch-state--error"
        role="alert"
        data-testid="types-error"
      >
        <p>{state.error || 'Failed to load items'}</p>
        {state.onRetry && (
          <button
            type="button"
            className="secondary-button types-state__retry-btn"
            onClick={state.onRetry}
            aria-label="Retry loading items"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (isEmptyState(state) || !state.data || state.data.length === 0) {
    return (
      <div
        className="empty-state types-state--empty fetch-state--empty"
        role="status"
        data-testid="types-empty"
      >
        <p>No items found.</p>
      </div>
    );
  }

  return (
    <ul data-testid="types-list">
      {state.data.map((item) => (
        <li key={item.id}>{item.title}</li>
      ))}
    </ul>
  );
}

describe('types.ts loading, empty, and error states (#1270)', () => {
  it('correctly resolves async states for loading, error, empty, and success', () => {
    expect(resolveAsyncState(null, true)).toEqual({
      status: 'loading',
      data: undefined,
      error: null,
      onRetry: undefined,
    });

    expect(resolveAsyncState(null, false, 'Network timeout connecting to Horizon')).toEqual({
      status: 'error',
      data: undefined,
      error: 'Network timeout connecting to Horizon',
      onRetry: undefined,
    });

    expect(resolveAsyncState([], false)).toEqual({
      status: 'empty',
      data: [],
      error: null,
      onRetry: undefined,
    });

    expect(resolveAsyncState([{ id: '1', title: 'Test Bounty' }], false)).toEqual({
      status: 'success',
      data: [{ id: '1', title: 'Test Bounty' }],
      error: null,
      onRetry: undefined,
    });

    // Alias resolveAsyncDataState also resolves identically
    expect(resolveAsyncDataState([], false)).toEqual({
      status: 'empty',
      data: [],
      error: null,
      onRetry: undefined,
    });
  });

  it('type guards distinguish between loading, empty, error, and success states', () => {
    const loading = resolveAsyncState<any>(null, true);
    const empty = resolveAsyncState<any>([], false);
    const error = resolveAsyncState<any>(null, false, 'Fetch error');
    const success = resolveAsyncState<any>([{ id: '1', title: 'Bounty' }], false);

    expect(isLoadingState(loading)).toBe(true);
    expect(isLoadingState(empty)).toBe(false);

    expect(isEmptyState(empty)).toBe(true);
    expect(isEmptyState(error)).toBe(false);

    expect(isErrorState(error)).toBe(true);
    expect(isErrorState(loading)).toBe(false);

    expect(isSuccessState(success)).toBe(true);
    expect(isSuccessState(empty)).toBe(false);
  });

  it('renders explicit and visually distinct loading state with accessible status and busy state', () => {
    const loadingState = resolveAsyncState<Bounty>(null, true);
    render(<TypesAsyncDataConsumer state={loadingState} />);

    const el = screen.getByTestId('types-loading');
    expect(el).toHaveClass('types-state--loading');
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/loading items/i)).toBeInTheDocument();
  });

  it('renders explicit and visually distinct empty state when records are empty', () => {
    const emptyState = resolveAsyncState<Bounty>([], false);
    render(<TypesAsyncDataConsumer state={emptyState} />);

    const el = screen.getByTestId('types-empty');
    expect(el).toHaveClass('types-state--empty');
    expect(el).toHaveAttribute('role', 'status');
    expect(screen.getByText(/no items found/i)).toBeInTheDocument();
  });

  it('renders explicit and visually distinct error state with retry affordance and handles retry click', async () => {
    const user = userEvent.setup();
    const handleRetry = vi.fn();
    const errorState = resolveAsyncState<Bounty>(
      null,
      false,
      'Connection refused to Stellar Horizon',
      handleRetry
    );

    render(<TypesAsyncDataConsumer state={errorState} />);

    const el = screen.getByTestId('types-error');
    expect(el).toHaveClass('types-state--error');
    expect(el).toHaveAttribute('role', 'alert');
    expect(screen.getByText(/connection refused to stellar horizon/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry loading items/i });
    expect(retryBtn).toBeInTheDocument();

    await user.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('renders list items on success state', () => {
    const successState = resolveAsyncState<any>(
      [
        { id: '1', title: 'Implement Rust contract' },
        { id: '2', title: 'Add responsive CSS' },
      ],
      false
    );

    render(<TypesAsyncDataConsumer state={successState} />);

    expect(screen.getByTestId('types-list')).toBeInTheDocument();
    expect(screen.getByText('Implement Rust contract')).toBeInTheDocument();
    expect(screen.getByText('Add responsive CSS')).toBeInTheDocument();
  });
});
