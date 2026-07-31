import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import type { Bounty } from './types';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock('./api', () => ({
  reserveBounty: vi.fn(),
  submitBounty: vi.fn(),
  releaseBounty: vi.fn(),
  refundBounty: vi.fn(),
  listBounties: vi.fn().mockResolvedValue([]),
  listOpenIssues: vi.fn().mockResolvedValue([]),
  getBounty: vi.fn(),
  exportReleasedPayoutsCsv: vi.fn(),
}));

import * as api from './api';
import App from './App';

const baseBounty: Bounty = {
  id: 'BNTY-1',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 1,
  title: 'Test bounty',
  summary: 'Summary',
  maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  contributor: undefined,
  tokenSymbol: 'XLM',
  amount: 100,
  labels: [],
  createdAt: 1700000000,
  deadlineAt: 9999999999,
  version: 1,
  events: [],
  status: 'open',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listOpenIssues).mockResolvedValue([]);
  window.prompt = vi.fn();
  window.alert = vi.fn();
});

describe('Toast notifications for async bounty actions', () => {
  it('shows success toast when bounty is reserved', async () => {
    const bounty = { ...baseBounty, status: 'open' as const };

    vi.mocked(api.listBounties).mockResolvedValue([bounty]);

    vi.mocked(window.prompt).mockReturnValue(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
    );

    vi.mocked(api.reserveBounty).mockResolvedValue({
      ...bounty,
      status: 'reserved',
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Test bounty')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Reserve' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Bounty reserved successfully!')
    );
  });

  it('shows error toast when reserve fails', async () => {
    vi.mocked(api.listBounties).mockResolvedValue([{ ...baseBounty, status: 'open' as const }]);

    vi.mocked(window.prompt).mockReturnValue(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
    );

    vi.mocked(api.reserveBounty).mockRejectedValue(new Error('Network error'));

    render(<App />);

    await waitFor(() => expect(screen.getByText('Test bounty')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Reserve' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network error'));
  });

  it('shows success toast when bounty is released', async () => {
    const bounty = {
      ...baseBounty,
      status: 'submitted' as const,
      contributor: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY',
    };

    vi.mocked(api.listBounties).mockResolvedValue([bounty]);

    vi.mocked(window.prompt).mockReturnValueOnce(baseBounty.maintainer).mockReturnValueOnce('');

    vi.mocked(api.releaseBounty).mockResolvedValue({
      ...bounty,
      status: 'released',
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Test bounty')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Release' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Bounty released — payment sent!')
    );
  });

  it('shows success toast when bounty is refunded', async () => {
    const bounty = {
      ...baseBounty,
      status: 'submitted' as const,
      contributor: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY',
    };

    vi.mocked(api.listBounties).mockResolvedValue([bounty]);

    vi.mocked(window.prompt).mockReturnValueOnce(baseBounty.maintainer).mockReturnValueOnce('');

    vi.mocked(api.refundBounty).mockResolvedValue({
      ...bounty,
      status: 'refunded',
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Test bounty')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Refund' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Bounty refunded successfully!')
    );
  });
});
