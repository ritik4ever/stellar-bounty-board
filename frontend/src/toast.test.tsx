import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';

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

const baseBounty = {
  id: 'BNTY-1',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 1,
  title: 'Test bounty',
  summary: 'Summary',
  maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  contributor: null,
  tokenSymbol: 'XLM',
  amount: 100,
  labels: [],
  createdAt: 1_700_000_000,
  deadlineAt: 9_999_999_999,
  version: 1,
  events: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listOpenIssues).mockResolvedValue([]);
  window.prompt = vi.fn();
  window.alert = vi.fn();
});

describe('Toast notifications for async bounty actions', () => {

  it('shows success toast when bounty is reserved', async () => {
    vi.mocked(api.listBounties).mockResolvedValue([{ ...baseBounty, status: 'open' }]);
    vi.mocked(window.prompt).mockReturnValue('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    vi.mocked(api.reserveBounty).mockResolvedValue(undefined);

    render(<App />);
    await waitFor(() => expect(screen.getByText('Test bounty')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Reserve' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Bounty reserved successfully!'),
    );
  });

  it('shows error toast when reserve fails', async () => {
    vi.mocked(api.listBounties).mockResolvedValue([{ ...baseBounty, status: 'open' }]);
    vi.mocked(window.prompt).mockReturnValue('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    vi.mocked(api.reserveBounty).mockRejectedValue(new Error('Network error'));

    render(<App />);
    await waitFor(() => expect(screen.getByText('Test bounty')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Reserve' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Network error'),
    );
  });

  it('shows error toast with Freighter rejection message', async () => {
    vi.mocked(api.listBounties).mockResolvedValue([{ ...baseBounty, status: 'open' }]);
    vi.mocked(window.prompt).mockReturnValue('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    vi.mocked(api.reserveBounty).mockRejectedValue(new Error('User declined access'));

    render(<App />);
    await waitFor(() => expect(screen.getByText('Test bounty')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Reserve' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('User declined access'),
    );
  });

  it('shows success toast when bounty is released', async () => {
    vi.mocked(api.listBounties).mockResolvedValue([{
      ...baseBounty,
      status: 'submitted',
      contributor: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY',
    }]);
    vi.mocked(window.prompt)
      .mockReturnValueOnce('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
      .mockReturnValueOnce('');
    vi.mocked(api.releaseBounty).mockResolvedValue(undefined);

    render(<App />);
    await waitFor(() => expect(screen.getByText('Test bounty')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Release' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Bounty released — payment sent!'),
    );
  });

  it('shows error toast when release fails', async () => {
    vi.mocked(api.listBounties).mockResolvedValue([{
      ...baseBounty,
      status: 'submitted',
      contributor: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY',
    }]);
    vi.mocked(window.prompt)
      .mockReturnValueOnce('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
      .mockReturnValueOnce('');
    vi.mocked(api.releaseBounty).mockRejectedValue(new Error('Release failed'));

    render(<App />);
    await waitFor(() => expect(screen.getByText('Test bounty')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Release' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Release failed'),
    );
  });

  it('shows success toast when bounty is refunded', async () => {
    vi.mocked(api.listBounties).mockResolvedValue([{
      ...baseBounty,
      status: 'submitted',
      contributor: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY',
    }]);
    vi.mocked(window.prompt)
      .mockReturnValueOnce('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
      .mockReturnValueOnce('');
    vi.mocked(api.refundBounty).mockResolvedValue(undefined);

    render(<App />);
    await waitFor(() => expect(screen.getByText('Test bounty')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Refund' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Bounty refunded successfully!'),
    );
  });

  it('shows error toast when refund fails', async () => {
    vi.mocked(api.listBounties).mockResolvedValue([{
      ...baseBounty,
      status: 'submitted',
      contributor: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY',
    }]);
    vi.mocked(window.prompt)
      .mockReturnValueOnce('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
      .mockReturnValueOnce('');
    vi.mocked(api.refundBounty).mockRejectedValue(new Error('Refund failed'));

    render(<App />);
    await waitFor(() => expect(screen.getByText('Test bounty')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Refund' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Refund failed'),
    );
  });
});