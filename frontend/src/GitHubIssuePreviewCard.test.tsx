import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import GitHubIssuePreviewCard from './GitHubIssuePreviewCard';

const mockIssue = {
  id: 'ISSUE-1',
  title: 'Fix bug in bounty system',
  labels: [
    { name: 'bug', color: 'fc2929' },
    { name: 'bounty', color: '006b75' },
  ],
  summary: 'A critical bug in the bounty system needs fixing',
  impact: 'core' as const,
};

describe('GitHubIssuePreviewCard', () => {
  it('renders the issue title', () => {
    render(<GitHubIssuePreviewCard issue={mockIssue} />);
    expect(screen.getByText('Fix bug in bounty system')).toBeDefined();
  });

  it('renders issue labels', () => {
    render(<GitHubIssuePreviewCard issue={mockIssue} />);
    expect(screen.getByText('bug')).toBeDefined();
    expect(screen.getByText('bounty')).toBeDefined();
  });

  it('renders the impact badge', () => {
    render(<GitHubIssuePreviewCard issue={mockIssue} />);
    expect(screen.getByText('core')).toBeDefined();
  });

  it('renders issue summary', () => {
    render(<GitHubIssuePreviewCard issue={mockIssue} />);
    expect(screen.getByText(/critical bug/i)).toBeDefined();
  });

  it('renders visually distinct loading state with skeleton and aria-busy', () => {
    render(<GitHubIssuePreviewCard loading={true} />);
    const loadingElem = screen.getByTestId('github-issue-preview-loading');
    expect(loadingElem).toBeDefined();
    expect(loadingElem.getAttribute('aria-busy')).toBe('true');
    expect(loadingElem.getAttribute('role')).toBe('status');
  });

  it('renders visually distinct empty state when no repository or issue data is available', () => {
    render(<GitHubIssuePreviewCard repo="" issueNumber={0} />);
    const emptyMsg = screen.getByRole('status');
    expect(emptyMsg).toBeDefined();
    expect(emptyMsg.textContent).toContain('No issue data available');
  });

  it('renders visually distinct error state and offers functioning retry affordance', async () => {
    const handleRetry = vi.fn();
    render(
      <GitHubIssuePreviewCard
        repo="stellar/quickstart"
        issueNumber={404}
        error="Network error fetching issue details"
        onRetry={handleRetry}
      />
    );

    const alertElem = screen.getByRole('alert');
    expect(alertElem).toBeDefined();
    expect(alertElem.textContent).toContain('Network error fetching issue details');

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeDefined();

    retryBtn.click();
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });
});
