import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { resolveFetchState, type AsyncFetchState } from './utils';

function AsyncDataConsumer<T extends { id: string; name: string }>({
  state,
}: {
  state: AsyncFetchState<T[]>;
}) {
  if (state.status === 'loading') {
    return (
      <div
        className="loading-state fetch-state--loading"
        role="status"
        aria-busy="true"
        data-testid="async-loading"
      >
        <p>Loading items...</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="error-state fetch-state--error" role="alert" data-testid="async-error">
        <p>{state.error || 'Failed to load items'}</p>
        {state.onRetry && (
          <button
            type="button"
            className="secondary-button"
            onClick={state.onRetry}
            aria-label="Retry loading items"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (state.status === 'empty' || !state.data || state.data.length === 0) {
    return (
      <div className="empty-state fetch-state--empty" role="status" data-testid="async-empty">
        <p>No items found.</p>
      </div>
    );
  }

  return (
    <ul data-testid="async-list">
      {state.data.map((item) => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
}

describe('utils loading, empty, and error states (#1273)', () => {
  it('correctly resolves fetch state for loading, error, empty, and success', () => {
    expect(resolveFetchState(null, true)).toEqual({
      status: 'loading',
      data: undefined,
      error: null,
      onRetry: undefined,
    });

    expect(resolveFetchState(null, false, 'Network timeout')).toEqual({
      status: 'error',
      data: undefined,
      error: 'Network timeout',
      onRetry: undefined,
    });

    expect(resolveFetchState([], false)).toEqual({
      status: 'empty',
      data: [],
      error: null,
      onRetry: undefined,
    });

    expect(resolveFetchState([{ id: '1', name: 'Item 1' }], false)).toEqual({
      status: 'success',
      data: [{ id: '1', name: 'Item 1' }],
      error: null,
      onRetry: undefined,
    });
  });

  it('renders explicit loading state with accessible status and busy state', () => {
    const loadingState = resolveFetchState<any>(null, true);
    render(<AsyncDataConsumer state={loadingState} />);

    const el = screen.getByTestId('async-loading');
    expect(el).toHaveClass('fetch-state--loading');
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/loading items/i)).toBeInTheDocument();
  });

  it('renders explicit empty state when records are empty', () => {
    const emptyState = resolveFetchState<any>([], false);
    render(<AsyncDataConsumer state={emptyState} />);

    const el = screen.getByTestId('async-empty');
    expect(el).toHaveClass('fetch-state--empty');
    expect(el).toHaveAttribute('role', 'status');
    expect(screen.getByText(/no items found/i)).toBeInTheDocument();
  });

  it('renders explicit error state with retry affordance and handles retry click', async () => {
    const user = userEvent.setup();
    const handleRetry = vi.fn();
    const errorState = resolveFetchState<any>(
      null,
      false,
      'Connection refused to RPC provider',
      handleRetry
    );

    render(<AsyncDataConsumer state={errorState} />);

    const el = screen.getByTestId('async-error');
    expect(el).toHaveClass('fetch-state--error');
    expect(el).toHaveAttribute('role', 'alert');
    expect(screen.getByText(/connection refused to rpc provider/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry loading items/i });
    await user.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });
});
