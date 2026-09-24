import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecommendedBounties from '../RecommendedBounties';
import * as api from '../api/bounties';
import { BrowserRouter } from 'react-router-dom';

// Mock the navigation hook
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

// Helper to render component inside a router
const renderWithRouter = (ui: React.ReactElement) =>
  render(<BrowserRouter>{ui}</BrowserRouter>);

describe('RecommendedBounties', () => {
  const mockBounties = [
    {
      id: '1',
      title: 'Fix typo in README',
      description: 'Correct a typo in the README file.',
      amount: 10,
    },
    {
      id: '2',
      title: 'Add new feature',
      description: 'Implement a new feature.',
      amount: 20,
    },
  ];

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('shows loading state initially', async () => {
    // Create a promise that never resolves to keep the component in loading state
    const pendingPromise = new Promise(() => {});
    jest.spyOn(api, 'getRecommendedBounties').mockReturnValue(pendingPromise as any);

    renderWithRouter(<RecommendedBounties />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  test('renders error message when API fails', async () => {
    jest.spyOn(api, 'getRecommendedBounties').mockRejectedValue(new Error('Network error'));

    renderWithRouter(<RecommendedBounties />);

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });

  test('renders empty state when no bounties are returned', async () => {
    jest.spyOn(api, 'getRecommendedBounties').mockResolvedValue([]);

    renderWithRouter(<RecommendedBounties />);

    await waitFor(() => {
      expect(screen.getByText(/no recommended bounties/i)).toBeInTheDocument();
    });
  });

  test('renders a list of bounties when data is available', async () => {
    jest.spyOn(api, 'getRecommendedBounties').mockResolvedValue(mockBounties);

    renderWithRouter(<RecommendedBounties />);

    // Wait for the list to appear
    await waitFor(() => {
      expect(screen.getByRole('list')).toBeInTheDocument();
    });

    // Verify each bounty card is rendered
    mockBounties.forEach((bounty) => {
      const card = screen.getByTestId(`bounty-card-${bounty.id}`);
      expect(card).toBeInTheDocument();
      expect(within(card).getByText(bounty.title)).toBeInTheDocument();
      expect(within(card).getByText(`$${bounty.amount}`)).toBeInTheDocument();
    });
  });

  test('clicking a bounty card navigates to the bounty detail page', async () => {
    jest.spyOn(api, 'getRecommendedBounties').mockResolvedValue(mockBounties);

    renderWithRouter(<RecommendedBounties />);

    await waitFor(() => {
      expect(screen.getByRole('list')).toBeInTheDocument();
    });

    // Assume each card has a button with text "View"
    const viewButton = screen.getByRole('button', { name: /view/i });
    await userEvent.click(viewButton);

    expect(mockNavigate).toHaveBeenCalledWith(`/bounty/${mockBounties[0].id}`);
  });
});
