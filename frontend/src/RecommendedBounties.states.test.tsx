import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import RecommendedBounties from './RecommendedBounties';

describe('RecommendedBounties.tsx loading and error states (#1283)', () => {
  it('renders visually distinct loading state with skeleton cards and aria-busy', () => {
    const { container } = render(
      <main>
        <RecommendedBounties recommendations={[]} loading={true} />
      </main>
    );

    const section = container.querySelector('.recommendations-panel');
    expect(section).toHaveAttribute('aria-busy', 'true');

    const skeletons = container.querySelectorAll('.bounty-card--skeleton');
    expect(skeletons.length).toBe(3);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders visually distinct empty state when no recommendations are present', () => {
    const { container } = render(
      <main>
        <RecommendedBounties recommendations={[]} loading={false} />
      </main>
    );

    const emptyContainer = container.querySelector('.empty-state');
    expect(emptyContainer).toBeInTheDocument();
    expect(
      screen.getByText(/No recommendations available yet\. Complete some bounties/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders visually distinct error state with alert role, error message, and retry affordance', async () => {
    const user = userEvent.setup();
    const handleRetry = vi.fn();

    const { container } = render(
      <main>
        <RecommendedBounties
          recommendations={[]}
          loading={false}
          error="Failed to connect to recommendation scoring service"
          onRetry={handleRetry}
        />
      </main>
    );

    const errorContainer = container.querySelector('.error-state');
    expect(errorContainer).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Unable to load recommendations')).toBeInTheDocument();
    expect(
      screen.getByText('Failed to connect to recommendation scoring service')
    ).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry loading recommendations/i });
    expect(retryBtn).toHaveClass('error-state__retry');
    await user.click(retryBtn);

    expect(handleRetry).toHaveBeenCalledTimes(1);
  });
});
