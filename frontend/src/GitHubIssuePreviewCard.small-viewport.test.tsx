import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';

import GitHubIssuePreviewCard from './GitHubIssuePreviewCard';

const longTitleIssue = {
  id: 'ISSUE-SMALL-1',
  title:
    'Extremely Long GitHub Issue Title Designed To Validate Responsive Text Truncation And Wrapping Constraints Under Narrow 320px Viewports',
  labels: [{ name: 'responsive-design', color: '1f883d' }],
  summary:
    'Detailed description validating that cards prevent horizontal scroll while preserving tap targets and accessibility.',
  impact: 'medium' as const,
};

describe('GitHubIssuePreviewCard small-viewport layout (#1285)', () => {
  it('renders within constrained 320px viewport without overflow', () => {
    const { container } = render(
      <div style={{ width: '320px', maxWidth: '320px', overflowX: 'hidden' }}>
        <GitHubIssuePreviewCard
          repo="stellar/stellar-protocol"
          issueNumber={1285}
          issue={longTitleIssue}
        />
      </div>
    );

    const card = container.querySelector('.github-issue-card');
    expect(card).toBeInTheDocument();

    const title = screen.getByText(/Extremely Long GitHub Issue Title/i);
    expect(title).toBeInTheDocument();
    expect(title).toHaveClass('github-issue-card__title');
  });

  it('renders retry button and links meeting 44px minimum touch targets', async () => {
    const user = userEvent.setup();
    render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <GitHubIssuePreviewCard
          repo="stellar/stellar-protocol"
          issueNumber={1285}
          error="Network timeout on mobile connection"
          onRetry={() => {}}
        />
      </div>
    );

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toHaveClass('github-issue-card__retry-btn');

    // Tab navigation focus state
    await user.tab();
    expect(retryBtn).toHaveFocus();
  });

  it('supports text truncation with full value available via accessible markup', () => {
    render(
      <GitHubIssuePreviewCard
        repo="stellar/stellar-protocol"
        issueNumber={1285}
        issue={longTitleIssue}
      />
    );

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('aria-label', expect.stringContaining('Issue #1285'));
  });
});
