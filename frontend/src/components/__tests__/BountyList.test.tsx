import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BountyList from '../BountyList';
import { fetchBounties } from '../../services/api';

vi.mock('../../services/api');

const mockBounties = [
  {
    id: '1',
    title: 'Test Bounty 1',
    description: 'Description 1',
    amount: 100,
    currency: 'XLM',
    status: 'open',
    creator: '0x123',
    createdAt: '2024-01-01',
  },
  {
    id: '2',
    title: 'Test Bounty 2',
    description: 'Description 2',
    amount: 200,
    currency: 'XLM',
    status: 'open',
    creator: '0x456',
    createdAt: '2024-01-02',
  },
];

describe('BountyList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show 6 skeleton cards during initial fetch', () => {
    (fetchBounties as jest.Mock).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    render(<BountyList />);

    const skeletonContainer = screen.getByRole('status');
    expect(skeletonContainer).toBeInTheDocument();
    expect(skeletonContainer).toHaveAttribute('aria-busy', 'true');

    const skeletonCards = screen.getAllByTestId('skeleton-bounty-card');
    expect(skeletonCards).toHaveLength(6);
  });

  it('should replace skeletons with real cards on successful fetch', async () => {
    (fetchBounties as jest.Mock).mockResolvedValue(mockBounties);

    render(<BountyList />);

    // Skeletons should appear first
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Wait for real cards
    await waitFor(() => {
      expect(screen.getByRole('list')).toBeInTheDocument();
    });

    expect(screen.getByText('Test Bounty 1')).toBeInTheDocument();
    expect(screen.getByText('Test Bounty 2')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('should show error state with retry button on fetch failure', async () => {
    const errorMessage = 'Network error';
    (fetchBounties as jest.Mock).mockRejectedValue(new Error(errorMessage));

    render(<BountyList />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText(`Error: ${errorMessage}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('should retry fetch when retry button is clicked', async () => {
    (fetchBounties as jest.Mock)
      .mockRejectedValueOnce(new Error('First attempt failed'))
      .mockResolvedValueOnce(mockBounties);

    render(<BountyList />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /retry/i });
    await userEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByRole('list')).toBeInTheDocument();
    });

    expect(screen.getByText('Test Bounty 1')).toBeInTheDocument();
    expect(fetchBounties).toHaveBeenCalledTimes(2);
  });
});
