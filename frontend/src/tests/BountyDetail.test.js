import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import BountyDetail from '../components/BountyDetail';
import api from '../services/api';

// Mock the API
jest.mock('../services/api');

describe('BountyDetail Component', () => {
  const mockBounty = {
    _id: 'bounty123',
    title: 'Test Bounty',
    description: 'Test description',
    reward: 100,
    deadlineAt: '2024-12-31T23:59:59Z',
    status: 'open',
    maintainer: 'GB...',
    isMaintainer: true
  };

  beforeEach(() => {
    jest.clearAllMocks();
    api.getBounty.mockResolvedValue({ data: mockBounty });
  });

  const renderComponent = () => {
    return render(
      <MemoryRouter initialEntries={['/bounties/bounty123']}>
        <Route path="/bounties/:id">
          <BountyDetail />
        </Route>
      </MemoryRouter>
    );
  };

  it('should render bounty details', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Test Bounty')).toBeInTheDocument();
      expect(screen.getByText('Test description')).toBeInTheDocument();
      expect(screen.getByText(/100 XLM/)).toBeInTheDocument();
    });
  });

  it('should show extend deadline button for maintainer', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Extend Deadline')).toBeInTheDocument();
    });
  });

  it('should not show extend deadline button for non-maintainer', async () => {
    api.getBounty.mockResolvedValue({
      data: { ...mockBounty, isMaintainer: false }
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.queryByText('Extend Deadline')).not.toBeInTheDocument();
    });
  });

  it('should open extend deadline modal on button click', async () => {
    renderComponent();

    await waitFor(() => {
      fireEvent.click(screen.getByText('Extend Deadline'));
    });

    expect(screen.getByText('Extend Deadline')).toBeInTheDocument();
    expect(screen.getByText('Confirm Extension')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should call extendDeadline API on confirm', async () => {
    api.extendDeadline.mockResolvedValue({
      data: {
        message: 'Deadline extended successfully',
        bounty: { id: 'bounty123', deadlineAt: '2025-12-31T23:59:59Z' }
      }
    });

    renderComponent();

    await waitFor(() => {
      fireEvent.click(screen.getByText('Extend Deadline'));
    });

    fireEvent.click(screen.getByText('Confirm Extension'));

    await waitFor(() => {
      expect(api.extendDeadline).toHaveBeenCalledWith('bounty123', {
        maintainer: 'GB...',
        newDeadline: expect.any(String)
      });
    });
  });

  it('should show error message on API failure', async () => {
    api.extendDeadline.mockRejectedValue({
      response: { data: { error: 'Failed to extend deadline' } }
    });

    renderComponent();

    await waitFor(() => {
      fireEvent.click(screen.getByText('Extend Deadline'));
    });

    fireEvent.click(screen.getByText('Confirm Extension'));

    await waitFor(() => {
      expect(screen.getByText('Failed to extend deadline')).toBeInTheDocument();
    });
  });

  it('should close modal on cancel', async () => {
    renderComponent();

    await waitFor(() => {
      fireEvent.click(screen.getByText('Extend Deadline'));
    });

    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(screen.queryByText('Confirm Extension')).not.toBeInTheDocument();
    });
  });
});
