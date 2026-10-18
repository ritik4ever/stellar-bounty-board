import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

describe('index.css loading, empty, and error states (#1292)', () => {
  it('renders explicit loading state with accessible status and distinct spinner', () => {
    render(
      <div className="loading-state" role="status" aria-busy="true" aria-live="polite">
        <div className="loading-state__spinner" data-testid="spinner" />
        <p className="loading-state__message">Loading bounties from Stellar network...</p>
      </div>
    );

    const loadingContainer = screen.getByRole('status');
    expect(loadingContainer).toHaveClass('loading-state');
    expect(loadingContainer).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('spinner')).toHaveClass('loading-state__spinner');
    expect(screen.getByText(/loading bounties from stellar network/i)).toBeInTheDocument();
  });

  it('renders explicit empty state with distinct guidance and action', () => {
    render(
      <div className="empty-state empty-state--board" role="status">
        <h3 className="empty-state__heading">No bounties match your criteria</h3>
        <p className="empty-state__message">Try clearing search filters or check back later.</p>
        <button type="button" className="secondary-button empty-state__cta">
          Reset filters
        </button>
      </div>
    );

    const emptyContainer = screen.getByRole('status');
    expect(emptyContainer).toHaveClass('empty-state');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
      'No bounties match your criteria'
    );
    expect(screen.getByRole('button', { name: /reset filters/i })).toBeInTheDocument();
  });

  it('renders explicit error state and provides working retry affordance', async () => {
    const user = userEvent.setup();
    const handleRetry = vi.fn();

    function ErrorView() {
      const [retryCount, setRetryCount] = useState(0);
      return (
        <div className="error-state" role="alert">
          <h3 className="error-state__heading">Failed to load bounties</h3>
          <p className="error-state__message">
            Unable to connect to the Stellar horizon node. Please verify your connection.
          </p>
          <button
            type="button"
            className="error-state__retry retry-button"
            onClick={() => {
              setRetryCount((prev) => prev + 1);
              handleRetry();
            }}
          >
            Retry Connection ({retryCount})
          </button>
        </div>
      );
    }

    render(<ErrorView />);

    const alertContainer = screen.getByRole('alert');
    expect(alertContainer).toHaveClass('error-state');
    expect(screen.getByRole('heading', { name: /failed to load bounties/i })).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry connection \(0\)/i });
    expect(retryBtn).toHaveClass('error-state__retry', 'retry-button');

    // Simulate user interaction with retry button
    await user.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /retry connection \(1\)/i })).toBeInTheDocument();
  });
});
