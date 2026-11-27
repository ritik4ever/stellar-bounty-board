import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BountyDetailPage from './BountyDetailPage';
import type { Bounty } from './types';

const mockBounty: Bounty = {
  id: 'BNTY-1',
  repo: 'test/repo',
  issueNumber: 1,
  title: 'Test Bounty',
  summary: 'Test summary',
  maintainer: 'GTEST',
  tokenSymbol: 'XLM',
  amount: 100,
  labels: [],
  status: 'open',
  createdAt: 1700000000,
  deadlineAt: 1700086400,
  version: 1,
  events: [],
};

describe('BountyDetailPage', () => {
  it('renders bounty title', () => {
    render(<BountyDetailPage bounty={mockBounty} />);
    expect(screen.getByText('Test Bounty')).toBeDefined();
  });

  it('renders bounty amount', () => {
    render(<BountyDetailPage bounty={mockBounty} />);
    expect(screen.getByText(/100/)).toBeDefined();
  });

  it('renders token symbol', () => {
    render(<BountyDetailPage bounty={mockBounty} />);
    expect(screen.getByText(/XLM/)).toBeDefined();
  });

  it('renders explicit loading state with accessible status and busy state (#1276)', () => {
    render(<BountyDetailPage bounty={null} loading={true} />);
    const loadingState = screen.getByTestId('bounty-detail-loading');
    expect(loadingState).toHaveClass('bounty-detail--loading');
    expect(loadingState).toHaveAttribute('role', 'status');
    expect(loadingState).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/loading bounty/i)).toBeInTheDocument();
  });

  it('renders explicit empty state when bounty is missing and not loading (#1276)', () => {
    render(<BountyDetailPage bounty={null} loading={false} />);
    const emptyState = screen.getByTestId('bounty-detail-empty');
    expect(emptyState).toHaveClass('bounty-detail--empty');
    expect(emptyState).toHaveAttribute('role', 'status');
    expect(screen.getByText(/bounty not found/i)).toBeInTheDocument();
  });

  it('renders explicit error state with retry affordance and handles click (#1276)', async () => {
    const user = userEvent.setup();
    const handleRetry = vi.fn();
    render(
      <BountyDetailPage
        bounty={null}
        loading={false}
        error="Network error while fetching bounty details"
        onRetry={handleRetry}
      />
    );

    const errorState = screen.getByTestId('bounty-detail-error');
    expect(errorState).toHaveClass('bounty-detail--error');
    expect(errorState).toHaveAttribute('role', 'alert');
    expect(screen.getByText(/network error while fetching bounty details/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry loading bounty/i });
    expect(retryBtn).toHaveClass('bounty-detail__retry-btn');

    await user.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });
});
