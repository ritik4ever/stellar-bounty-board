import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bounty } from './types';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock('./api', () => ({
  getAdminApiKey: vi.fn(),
  setAdminApiKey: vi.fn(),
  clearAdminApiKey: vi.fn(),
  verifyAdminKey: vi.fn(),
  listBounties: vi.fn(),
  exportAuditLog: vi.fn(),
  exportReleasedPayoutsCsv: vi.fn(),
  runAdminArchive: vi.fn(),
  releaseBountySigned: vi.fn(),
  refundBountySigned: vi.fn(),
}));

vi.mock('./hooks/useFreighter', () => ({
  useFreighter: vi.fn(),
}));

import * as api from './api';
import { useFreighter } from './hooks/useFreighter';
import AdminDashboard from './AdminDashboard';

const MAINTAINER_KEY = 'GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK';

function bounty(overrides: Partial<Bounty>): Bounty {
  return {
    id: 'BNT-0001',
    repo: 'owner/repo',
    issueNumber: 1,
    title: 'Test bounty',
    summary: 'Summary',
    maintainer: MAINTAINER_KEY,
    tokenSymbol: 'XLM',
    amount: 100,
    labels: [],
    status: 'open',
    createdAt: 1_700_000_000,
    deadlineAt: 9_999_999_999,
    version: 1,
    events: [],
    ...overrides,
  };
}

const submittedBounty = bounty({
  id: 'BNT-1001',
  title: 'Submitted work',
  status: 'submitted',
  contributor: 'GBE6AZEUPV75O3Z7OFW4RIMU7DF453AVK5HCXB3PV2I7BBTYEPCOYWSF',
});

const disputedBounty = bounty({ id: 'BNT-1002', title: 'Disputed work', status: 'disputed' });

const reservedBounty = bounty({
  id: 'BNT-1003',
  title: 'Reserved work',
  status: 'reserved',
  contributor: 'GBE6AZEUPV75O3Z7OFW4RIMU7DF453AVK5HCXB3PV2I7BBTYEPCOYWSF',
});

const expiredBounty = bounty({ id: 'BNT-1004', title: 'Expired work', status: 'expired' });

const openBounty = bounty({ id: 'BNT-1005', title: 'Open work', status: 'open' });

function mockConnectedWallet() {
  vi.mocked(useFreighter).mockReturnValue({
    isConnected: true,
    publicKey: MAINTAINER_KEY,
    isOnCorrectNetwork: true,
    error: null,
    connecting: false,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    signPayload: vi.fn().mockResolvedValue({ signature: 'deadbeef', publicKey: MAINTAINER_KEY }),
  });
}

function mockDisconnectedWallet() {
  vi.mocked(useFreighter).mockReturnValue({
    isConnected: false,
    publicKey: null,
    isOnCorrectNetwork: false,
    error: null,
    connecting: false,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    signPayload: vi.fn(),
  });
}

function mockBrowserApis() {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
}

async function submitAdminKey(user: ReturnType<typeof userEvent.setup>, key: string) {
  const passwordInput = await screen.findByLabelText('Admin API key');
  await user.type(passwordInput, key);
  await user.click(screen.getByRole('button', { name: /unlock dashboard/i }));
}

async function unlockDashboard(user: ReturnType<typeof userEvent.setup>, key = 'secret-admin-key') {
  vi.mocked(api.verifyAdminKey).mockResolvedValue(true);
  await submitAdminKey(user, key);
  await waitFor(() => {
    expect(api.setAdminApiKey).toHaveBeenCalledWith(key);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBrowserApis();
  vi.mocked(api.getAdminApiKey).mockReturnValue(null);
  vi.mocked(api.listBounties).mockResolvedValue([
    submittedBounty,
    disputedBounty,
    reservedBounty,
    expiredBounty,
    openBounty,
  ]);
});

describe('AdminDashboard — access control', () => {
  it('blocks non-admins: shows the gate and no dashboard content', () => {
    render(<AdminDashboard onBack={() => undefined} />);

    expect(screen.getByText('Admin access required')).toBeInTheDocument();
    expect(screen.queryByText('Operational summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Bulk release / refund')).not.toBeInTheDocument();
  });

  it('unlocks the dashboard after a valid admin key is verified', async () => {
    const user = userEvent.setup();
    render(<AdminDashboard onBack={() => undefined} />);

    await unlockDashboard(user);

    expect(screen.getByRole('heading', { name: 'Admin dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Operational summary')).toBeInTheDocument();
  });

  it('stays locked and shows an error for an invalid admin key', async () => {
    const user = userEvent.setup();
    vi.mocked(api.verifyAdminKey).mockResolvedValue(false);

    render(<AdminDashboard onBack={() => undefined} />);

    await submitAdminKey(user, 'wrong-key');
    expect(await screen.findByText('Invalid admin key. Access denied.')).toBeInTheDocument();

    // verifyAdminKey was called with the entered key, but nothing was stored.
    expect(api.verifyAdminKey).toHaveBeenCalledWith('wrong-key');
    expect(api.setAdminApiKey).not.toHaveBeenCalled();
    expect(screen.queryByText('Operational summary')).not.toBeInTheDocument();
  });
});

describe('AdminDashboard — operational metrics', () => {
  it('renders open disputes and pending bounties from the bounty list', async () => {
    const user = userEvent.setup();
    render(<AdminDashboard onBack={() => undefined} />);

    await unlockDashboard(user);

    const summary = await screen.findByLabelText('Operational metrics');
    const disputesCard = within(summary).getByText('Open disputes').closest('.metric-card');
    expect(disputesCard).not.toBeNull();
    expect(within(disputesCard as HTMLElement).getByText('1')).toBeInTheDocument(); // disputed
    const pendingCard = within(summary).getByText('Pending bounties').closest('.metric-card');
    expect(pendingCard).not.toBeNull();
    expect(within(pendingCard as HTMLElement).getByText('2')).toBeInTheDocument(); // reserved + submitted
  });
});

describe('AdminDashboard — admin actions', () => {
  it('exports the audit log as a downloadable JSON file', async () => {
    const user = userEvent.setup();
    vi.mocked(api.exportAuditLog).mockResolvedValue({
      blob: new Blob(['[{"id":"1"}]'], { type: 'application/json' }),
      filename: 'audit-log-2026-08-27T00-00-00.json',
    });

    render(<AdminDashboard onBack={() => undefined} />);
    await unlockDashboard(user);

    await user.click(await screen.findByRole('button', { name: /export audit log/i }));

    await waitFor(() => expect(api.exportAuditLog).toHaveBeenCalledTimes(1));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    const { toast } = await import('sonner');
    expect(toast.success).toHaveBeenCalledWith('Audit log exported.');
  });

  it('runs the archive job and reports how many bounties were archived', async () => {
    const user = userEvent.setup();
    vi.mocked(api.runAdminArchive).mockResolvedValue({
      archivedCount: 2,
      archivedBountyIds: ['BNT-0001', 'BNT-0002'],
      checkedAt: 1_700_000_000,
    });

    render(<AdminDashboard onBack={() => undefined} />);
    await unlockDashboard(user);

    await user.click(await screen.findByRole('button', { name: /run archive/i }));

    await waitFor(() => expect(api.runAdminArchive).toHaveBeenCalledTimes(1));
    const { toast } = await import('sonner');
    expect(toast.success).toHaveBeenCalledWith('Archived 2 bounties.');
  });
});

describe('AdminDashboard — bulk release / refund', () => {
  it('lists only actionable bounties and releases the selected ones with a wallet signature', async () => {
    const user = userEvent.setup();
    mockConnectedWallet();

    render(<AdminDashboard onBack={() => undefined} />);
    await unlockDashboard(user);

    // Only submitted / reserved / expired / open bounties are actionable —
    // disputed bounties are resolved by the arbiter, not bulk-released.
    const bulkSection = await screen.findByLabelText('Bulk release and refund');
    expect(within(bulkSection).getByText('Submitted work')).toBeInTheDocument();
    expect(within(bulkSection).getByText('Reserved work')).toBeInTheDocument();
    expect(within(bulkSection).getByText('Expired work')).toBeInTheDocument();
    expect(within(bulkSection).queryByText('Disputed work')).not.toBeInTheDocument();

    // Release only the submitted bounty.
    await user.click(within(bulkSection).getByLabelText('Select BNT-1001'));
    await user.click(screen.getByRole('button', { name: /release selected \(1\)/i }));

    await waitFor(() => {
      expect(api.releaseBountySigned).toHaveBeenCalledTimes(1);
    });
    const [id, payload, signature, publicKey] = vi.mocked(api.releaseBountySigned).mock.calls[0];
    expect(id).toBe('BNT-1001');
    expect(payload.action).toBe('release');
    expect(payload.bountyId).toBe('BNT-1001');
    expect(payload.maintainer).toBe(MAINTAINER_KEY);
    expect(signature).toBe('deadbeef');
    expect(publicKey).toBe(MAINTAINER_KEY);
  });

  it('blocks bulk actions when the wallet is not connected', async () => {
    const user = userEvent.setup();
    mockDisconnectedWallet();

    render(<AdminDashboard onBack={() => undefined} />);
    await unlockDashboard(user);

    const bulkSection = await screen.findByLabelText('Bulk release and refund');
    await user.click(within(bulkSection).getByLabelText('Select BNT-1001'));
    await user.click(screen.getByRole('button', { name: /release selected \(1\)/i }));

    const { toast } = await import('sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Please connect your Freighter wallet first to sign the bulk action.'
      );
    });
    expect(api.releaseBountySigned).not.toHaveBeenCalled();
  });
});
