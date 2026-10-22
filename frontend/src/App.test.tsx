import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import App from './App';

describe('App component', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders without crashing', () => {
    fetchMock.mockResolved({
      ok: true,
      json: async () => ([]),
    });
    const { container } = render(<App />);
    expect(container).toBeDefined();
    expect(container.firstChild).not.toBeNull();
  });

  it('shows a loading state while the request is in flight', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<App />);
    expect(screen.getByTestId('app-loading')).toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows an empty state when the request succeeds with no data', async () => {
    fetchMock.mockResolved({
      ok: true,
      json: async () => ([]),
    });
    render(<App />);
    expect(await screen.findByTestId('app-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('app-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-error')).not.toBeInTheDocument();
  });

  it('shows an error state with a retry affordance when the request fails', async () => {
    fetchMock.mockRejected(new Error('Network error'));
    render(<App />);
    expect(await screen.findByTestId('app-error')).toBeInTheDocument();
    expect(screen.queryByTestId('app-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-empty')).not.toBeInTheDocument();
    const retryButton = screen.getByTestId('app-retry');
    expect(retryButton).toBeInTheDocument();
  });

  it('retries the request when the retry button is clicked', async () => {
    fetchMock.mockRejected(new Error('Network error'));
    render(<App />);
    const retryButton = await screen.findByTestId('app-retry');

    fetchMock.mockResolved({
      ok: true,
      json: async () => ([]),
    });
    fireEvent.click(retryButton);

    expect(await screen.findByTestId('app-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('app-error')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// Documented: 2026-10-01 -- per issue #1261
