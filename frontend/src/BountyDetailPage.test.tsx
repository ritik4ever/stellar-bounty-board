import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import BountyDetailPage from './BountyDetailPage';
import type { Bounty, BountyStatus } from './types';

const statusCopy: Record<BountyStatus, { label: string; description: string }> = {
  open: { label: 'Open', description: 'Ready for contributors.' },
  reserved: { label: 'Reserved', description: 'Reserved by a contributor.' },
  submitted: { label: 'Submitted', description: 'Submission under review.' },
  released: { label: 'Released', description: 'Funds released.' },
  refunded: { label: 'Refunded', description: 'Funds refunded.' },
  expired: { label: 'Expired', description: 'Past deadline.' },
};

const actionCopy: Record<BountyStatus, []> = {
  open: [],
  reserved: [],
  submitted: [],
  released: [],
  refunded: [],
  expired: [],
};

const bounty: Bounty = {
  id: 'BNTY-42',
  repo: 'ritik4ever/stellar-bounty-board',
  issueNumber: 73,
  title: 'Copy button test bounty',
  summary: 'Make important identifiers easy to copy.',
  maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  contributor: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK',
  tokenSymbol: 'XLM',
  amount: 150,
  labels: [],
  status: 'open',
  createdAt: 1_700_000_000,
  deadlineAt: 1_700_086_400,
  version: 1,
  events: [],
};

function renderDetail() {
  return render(
    <BountyDetailPage
      bounty={bounty}
      loading={false}
      onBack={() => undefined}
      owner="ritik4ever"
      avatarUrl=""
      statusCopy={statusCopy}
      actionCopy={actionCopy}
      renderActionButton={() => null}
      formatTimestamp={() => 'Jan 1, 2024'}
    />,
  );
}

describe('BountyDetailPage copy actions', () => {
  it('copies the bounty ID from the detail metadata', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderDetail();

    await userEvent.click(screen.getByRole('button', { name: /copy bounty id/i }));

    expect(writeText).toHaveBeenCalledWith('BNTY-42');
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
  });

  it('copies the maintainer wallet address from the detail metadata', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderDetail();

    await userEvent.click(screen.getByRole('button', { name: /copy maintainer wallet address/i }));

    expect(writeText).toHaveBeenCalledWith(bounty.maintainer);
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
  });
});
