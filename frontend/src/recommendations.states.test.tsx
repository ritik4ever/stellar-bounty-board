import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import RecommendedBounties from './RecommendedBounties';

describe('recommendations explicit loading, empty, and error states (#1289)', () => {
  it('renders visually distinct loading state with aria-busy and skeleton cards', () => {
    render(<RecommendedBounties recommendations={[]} loading={true} walletConnected={true} />);

    const section = screen.getByRole('region', { hidden: true });
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(section.querySelectorAll('.bounty-card--skeleton').length).toBeGreaterThan(0);
  });

  it('renders visually distinct empty state when no recommendations are available', () => {
    render(
      <RecommendedBounties
        recommendations={[]}
        loading={false}
        error={null}
        walletConnected={true}
      />
    );

    const emptyContainer = screen.getByRole('status');
    expect(emptyContainer).toHaveClass('empty-state');
    expect(screen.getByText(/no recommendations available yet/i)).toBeInTheDocument();
  });

  it('renders visually distinct error state with message and functioning retry affordance', async () => {
    const user = userEvent.setup();
    const handleRetry = vi.fn();

    function ErrorWrapper() {
      const [retryCount, setRetryCount] = useState(0);
      return (
        <RecommendedBounties
          recommendations={[]}
          loading={false}
          error={`Network timeout while querying recommendations (attempt ${retryCount})`}
          onRetry={() => {
            setRetryCount((prev) => prev + 1);
            handleRetry();
          }}
          walletConnected={true}
        />
      );
    }

    render(<ErrorWrapper />);

    const alertBox = screen.getByRole('alert');
    expect(alertBox).toHaveClass('error-state');
    expect(
      screen.getByRole('heading', { name: /unable to load recommendations/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/network timeout while querying recommendations/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', {
      name: /retry loading recommendations/i,
    });
    expect(retryBtn).toHaveClass('error-state__retry', 'retry-button');

    // Simulate user clicking retry
    await user.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/attempt 1/i)).toBeInTheDocument();
  });
});
