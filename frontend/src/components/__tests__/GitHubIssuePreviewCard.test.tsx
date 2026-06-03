import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GitHubIssuePreviewCard from '../GitHubIssuePreviewCard';

const mockIssueData = {
  title: 'Test Issue Title',
  state: 'open',
  labels: [
    { name: 'bug', color: 'd73a4a' },
    { name: 'enhancement', color: 'a2eeef' },
  ],
  created_at: '2024-01-15T10:00:00Z',
  html_url: 'https://github.com/test-owner/test-repo/issues/42',
  number: 42,
  user: { login: 'testuser', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
};

describe('GitHubIssuePreviewCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading skeleton initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(
      () =>
        new Promise(() => {}) // never resolves to keep loading state
    );

    render(<GitHubIssuePreviewCard repo="test-owner/test-repo" issueNumber={42} />);
    expect(screen.getByText(/loading/i) || document.querySelector('.ant-skeleton')).toBeTruthy();
  });

  it('renders issue title and labels after successful fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockIssueData,
    } as Response);

    render(<GitHubIssuePreviewCard repo="test-owner/test-repo" issueNumber={42} />);

    await waitFor(() => {
      expect(screen.getByText('Test Issue Title')).toBeInTheDocument();
    });

    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('enhancement')).toBeInTheDocument();
    expect(screen.getByText('OPEN')).toBeInTheDocument();
    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText(/testuser/)).toBeInTheDocument();
  });

  it('shows error state with link to GitHub on 404', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);

    render(<GitHubIssuePreviewCard repo="test-owner/test-repo" issueNumber={999} />);

    await waitFor(() => {
      expect(screen.getByText(/Issue not found/i)).toBeInTheDocument();
    });

    const githubLink = screen.getByRole('link', { name: /view on github/i });
    expect(githubLink).toBeInTheDocument();
    expect(githubLink).toHaveAttribute(
      'href',
      'https://github.com/test-owner/test-repo/issues/999'
    );
  });

  it('shows rate limit warning on 403', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as Response);

    render(<GitHubIssuePreviewCard repo="test-owner/test-repo" issueNumber={42} />);

    await waitFor(() => {
      expect(screen.getByText(/rate limit exceeded/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/60 per hour/i)).toBeInTheDocument();
  });

  it('shows error on network failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    render(<GitHubIssuePreviewCard repo="test-owner/test-repo" issueNumber={42} />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });

  it('renders closed state correctly', async () => {
    const closedIssue = {
      ...mockIssueData,
      state: 'closed',
      title: 'Closed Issue',
    };

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => closedIssue,
    } as Response);

    render(<GitHubIssuePreviewCard repo="test-owner/test-repo" issueNumber={42} />);

    await waitFor(() => {
      expect(screen.getByText('CLOSED')).toBeInTheDocument();
    });

    expect(screen.getByText('Closed Issue')).toBeInTheDocument();
  });
});
