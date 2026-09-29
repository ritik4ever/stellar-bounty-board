import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import StatsBanner from './StatsBanner';
import type { GlobalMetrics } from './types';

const stats: GlobalMetrics = {
  totalBounties: 12,
  openCount: 4,
  reservedCount: 2,
  submittedCount: 1,
  releasedCount: 3,
  refundedCount: 1,
  expiredCount: 1,
  totalFunded: 1000,
  totalReleased: 400,
  uniqueMaintainers: 2,
  uniqueContributors: 3,
};

describe('StatsBanner (#1458)', () => {
  it('renders total bounties, locked funds, and open count', () => {
    render(<StatsBanner stats={stats} />);

    expect(screen.getByText('Total bounties')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('XLM locked')).toBeInTheDocument();
    // 1000 funded − 400 released = 600 still escrowed
    expect(screen.getByText('600')).toBeInTheDocument();
    expect(screen.getByText('Open bounties')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders nothing before the first successful fetch', () => {
    const { container } = render(<StatsBanner stats={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a loading placeholder while the first fetch is pending', () => {
    const { container } = render(<StatsBanner stats={null} loading />);
    expect(container.querySelector('.stats-banner--loading')).not.toBeNull();
  });

  it('never reports negative locked funds when drift makes released exceed funded', () => {
    render(<StatsBanner stats={{ ...stats, totalFunded: 100, totalReleased: 250 }} />);
    expect(screen.getByText('XLM locked').parentElement).toHaveTextContent('0');
  });
});
