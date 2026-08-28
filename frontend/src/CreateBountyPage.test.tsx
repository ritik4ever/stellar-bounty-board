import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CreateBountyPage from './CreateBountyPage';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock('./api', () => ({
  createBounty: vi.fn(),
}));

import * as api from './api';

function mockBrowserApis() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderPage(initialPath = '/bounties/new') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/bounties/new" element={<CreateBountyPage />} />
        <Route path="/" element={<div>Home</div>} />
        <Route path="/bounties/:id" element={<div>Bounty Detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBrowserApis();
});

describe('CreateBountyPage', () => {
  it('renders the creation form as a standalone page', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /create new bounty/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/repository/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reward/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create bounty/i })).toBeInTheDocument();
  });

  it('has a back to board navigation link', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /back to bounty board/i })).toBeInTheDocument();
  });

  it('shows an error when the repository field is empty', async () => {
    const user = userEvent.setup();
    renderPage();

    const repoInput = screen.getByPlaceholderText('owner/repo');
    await user.clear(repoInput);
    await user.type(repoInput, ' ');

    const titleInput = screen.getByPlaceholderText('Add WebSocket updates...');
    await user.clear(titleInput);
    await user.type(titleInput, 'Valid title');

    const submitButton = screen.getByRole('button', { name: /create bounty/i });
    await user.click(submitButton);

    const { toast } = await import('sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Repository is required.');
    });
    expect(api.createBounty).not.toHaveBeenCalled();
  });

  it('shows an error when the title field is empty', async () => {
    const user = userEvent.setup();
    renderPage();

    const repoInput = screen.getByPlaceholderText('owner/repo');
    await user.clear(repoInput);
    await user.type(repoInput, 'owner/repo');

    const titleInput = screen.getByPlaceholderText('Add WebSocket updates...');
    await user.clear(titleInput);

    const submitButton = screen.getByRole('button', { name: /create bounty/i });
    await user.click(submitButton);

    const { toast } = await import('sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Title is required.');
    });
    expect(api.createBounty).not.toHaveBeenCalled();
  });

  it('shows an error when the reward amount is zero or negative', async () => {
    const user = userEvent.setup();
    renderPage();

    const repoInput = screen.getByPlaceholderText('owner/repo');
    await user.clear(repoInput);
    await user.type(repoInput, 'owner/repo');

    const titleInput = screen.getByPlaceholderText('Add WebSocket updates...');
    await user.clear(titleInput);
    await user.type(titleInput, 'Valid title');

    const amountInput = screen.getByRole('spinbutton', { name: /reward/i });
    await user.clear(amountInput);
    await user.type(amountInput, '0');

    const submitButton = screen.getByRole('button', { name: /create bounty/i });
    await user.click(submitButton);

    const { toast } = await import('sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Reward amount must be greater than 0.');
    });
    expect(api.createBounty).not.toHaveBeenCalled();
  });

  it('calls createBounty and shows success toast on valid submission', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createBounty).mockResolvedValue({
      id: 'BNTY-123',
      repo: 'owner/repo',
      issueNumber: 42,
      title: 'My new bounty',
      summary: '',
      maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      tokenSymbol: 'XLM',
      amount: 150,
      labels: [],
      status: 'open',
      createdAt: 1_700_000_000,
      deadlineAt: 9_999_999_999,
      version: 1,
      events: [],
    });

    renderPage();

    const repoInput = screen.getByPlaceholderText('owner/repo');
    await user.clear(repoInput);
    await user.type(repoInput, 'owner/repo');

    const titleInput = screen.getByPlaceholderText('Add WebSocket updates...');
    await user.clear(titleInput);
    await user.type(titleInput, 'My new bounty');

    const submitButton = screen.getByRole('button', { name: /create bounty/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(api.createBounty).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'owner/repo',
          title: 'My new bounty',
        })
      );
    });

    const { toast } = await import('sonner');
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Bounty created successfully!');
    });
  });

  it("redirects to the new bounty's detail page on successful creation", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createBounty).mockResolvedValue({
      id: 'BNTY-456',
      repo: 'owner/repo',
      issueNumber: 42,
      title: 'Redirect test bounty',
      summary: '',
      maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      tokenSymbol: 'XLM',
      amount: 100,
      labels: [],
      status: 'open',
      createdAt: 1_700_000_000,
      deadlineAt: 9_999_999_999,
      version: 1,
      events: [],
    });

    renderPage();

    const repoInput = screen.getByPlaceholderText('owner/repo');
    await user.clear(repoInput);
    await user.type(repoInput, 'owner/repo');

    const titleInput = screen.getByPlaceholderText('Add WebSocket updates...');
    await user.clear(titleInput);
    await user.type(titleInput, 'Redirect test bounty');

    const submitButton = screen.getByRole('button', { name: /create bounty/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Bounty Detail')).toBeInTheDocument();
    });
  });

  it('shows loading/disabled state while the creation request is in flight', async () => {
    const user = userEvent.setup();
    let resolveCreate!: (value: unknown) => void;
    vi.mocked(api.createBounty).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }) as never
    );

    renderPage();

    const repoInput = screen.getByPlaceholderText('owner/repo');
    await user.clear(repoInput);
    await user.type(repoInput, 'owner/repo');

    const titleInput = screen.getByPlaceholderText('Add WebSocket updates...');
    await user.clear(titleInput);
    await user.type(titleInput, 'Test bounty');

    const submitButton = screen.getByRole('button', { name: /create bounty/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /creating.../i })).toBeDisabled();
    });

    // Resolve the promise to clean up
    resolveCreate({
      id: 'BNTY-789',
      repo: 'owner/repo',
      issueNumber: 48,
      title: 'Test bounty',
      summary: '',
      maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      tokenSymbol: 'XLM',
      amount: 150,
      labels: [],
      status: 'open',
      createdAt: 1_700_000_000,
      deadlineAt: 9_999_999_999,
      version: 1,
      events: [],
    });
  });
});
