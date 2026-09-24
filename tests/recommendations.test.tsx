/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Recommendations } from '../frontend/src/recommendations';
import { fetchRecommendations } from '../frontend/src/api';
import { useNavigate } from 'react-router-dom';

// Mock the API that the component uses to fetch data
jest.mock('../frontend/src/api', () => ({
  fetchRecommendations: jest.fn(),
}));

// Mock react-router-dom's useNavigate hook
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: jest.fn(),
}));

describe('Recommendations component', () => {
  const mockNavigate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useNavigate as jest.Mock).mockReturnValue(mockNavigate);
  });

  test('renders loading state initially', async () => {
    // Resolve the promise after a short delay to keep the component in loading state
    (fetchRecommendations as jest.Mock).mockReturnValue(new Promise(() => {}));

    render(<Recommendations />);

    // The loading indicator should be visible immediately
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    // No other elements should be present
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no recommendations/i)).not.toBeInTheDocument();
  });

  test('renders error state when fetch fails', async () => {
    const errorMessage = 'Network error';
    (fetchRecommendations as jest.Mock).mockRejectedValue(new Error(errorMessage));

    render(<Recommendations />);

    // Wait for the component to finish rendering the error state
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });

    expect(screen.getByText(errorMessage)).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no recommendations/i)).not.toBeInTheDocument();
  });

  test('renders empty state when no recommendations are returned', async () => {
    (fetchRecommendations as jest.Mock).mockResolvedValue([]);

    render(<Recommendations />);

    await waitFor(() => {
      expect(screen.getByText(/no recommendations/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  test('renders list of recommendations and handles click navigation', async () => {
    const mockData = [
      { id: '1', title: 'Fix bug in UI' },
      { id: '2', title: 'Add new feature' },
    ];
    (fetchRecommendations as jest.Mock).mockResolvedValue(mockData);

    render(<Recommendations />);

    // Wait for the list to appear
    await waitFor(() => {
      expect(screen.getByText('Fix bug in UI')).toBeInTheDocument();
      expect(screen.getByText('Add new feature')).toBeInTheDocument();
    });

    // Ensure no loading or error messages are shown
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();

    // Click the first recommendation
    const firstButton = screen.getByRole('button', { name: /fix bug in ui/i });
    await userEvent.click(firstButton);

    // Verify navigation was called with the correct id
    expect(mockNavigate).toHaveBeenCalledWith('/bounty/1');
  });
});
