import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ReportBountyModal from './ReportBountyModal';
import { reportBounty } from './api';

vi.mock('./api', () => ({
  reportBounty: vi.fn(),
}));

const reportBountyMock = vi.mocked(reportBounty);

function renderModal(bountyId = 'BNTY-42') {
  return render(<ReportBountyModal bountyId={bountyId} onClose={vi.fn()} />);
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  reportBountyMock.mockReset();
});

describe('ReportBountyModal', () => {
  it('submits the entered reason and shows a confirmation', async () => {
    reportBountyMock.mockResolvedValue({
      id: 'RPT-000001',
      bountyId: 'BNTY-42',
      reason: 'Looks like a scam.',
      reportedAt: 1_700_000_000,
    });
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText('Reason'), 'Looks like a scam.');
    await user.click(screen.getByRole('button', { name: 'Submit report' }));

    await waitFor(() => {
      expect(reportBountyMock).toHaveBeenCalledWith('BNTY-42', 'Looks like a scam.');
    });
    expect(await screen.findByText('Report submitted')).toBeInTheDocument();
  });

  it('keeps the submit button disabled and does not call the API while the reason is empty', async () => {
    const user = userEvent.setup();
    renderModal('BNTY-43');

    const submit = screen.getByRole('button', { name: 'Submit report' });
    expect(submit).toBeDisabled();

    // Whitespace-only input is treated as empty.
    await user.type(screen.getByLabelText('Reason'), '   ');
    expect(submit).toBeDisabled();

    await user.click(submit);
    expect(reportBountyMock).not.toHaveBeenCalled();
  });

  it('shows an error message when the submission fails', async () => {
    reportBountyMock.mockRejectedValue(new Error('Report failed'));
    const user = userEvent.setup();
    renderModal('BNTY-44');

    await user.type(screen.getByLabelText('Reason'), 'Broken payouts.');
    await user.click(screen.getByRole('button', { name: 'Submit report' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/report failed/i);
    expect(reportBountyMock).toHaveBeenCalledWith('BNTY-44', 'Broken payouts.');
  });

  it('throttles repeated reports for the same bounty in the same session', async () => {
    reportBountyMock.mockResolvedValue({
      id: 'RPT-000002',
      bountyId: 'BNTY-45',
      reason: 'Duplicate scam report.',
      reportedAt: 1_700_000_000,
    });
    const user = userEvent.setup();

    // First report succeeds.
    const first = renderModal('BNTY-45');
    await user.type(screen.getByLabelText('Reason'), 'Duplicate scam report.');
    await user.click(screen.getByRole('button', { name: 'Submit report' }));
    await screen.findByText('Report submitted');
    expect(reportBountyMock).toHaveBeenCalledTimes(1);

    // Re-opening the modal for the same bounty in this session is throttled.
    first.unmount();
    const second = renderModal('BNTY-45');
    expect(await screen.findByText('Already reported')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit report' })).not.toBeInTheDocument();
    expect(reportBountyMock).toHaveBeenCalledTimes(1);

    second.unmount();
  });

  it('allows reporting a different bounty after reporting one', async () => {
    reportBountyMock.mockResolvedValue({
      id: 'RPT-000003',
      bountyId: 'BNTY-46',
      reason: 'Another issue.',
      reportedAt: 1_700_000_000,
    });
    const user = userEvent.setup();

    renderModal('BNTY-46');
    await user.type(screen.getByLabelText('Reason'), 'Another issue.');
    await user.click(screen.getByRole('button', { name: 'Submit report' }));
    await screen.findByText('Report submitted');

    // A different bounty is not throttled.
    const other = renderModal('BNTY-47');
    expect(await screen.findByRole('button', { name: 'Submit report' })).toBeInTheDocument();
    expect(screen.queryByText('Already reported')).not.toBeInTheDocument();
    other.unmount();
  });
});
