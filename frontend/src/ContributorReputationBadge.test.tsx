import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ContributorReputationBadge from './ContributorReputationBadge';
import type { ContributorReputation } from './types';

const returning: ContributorReputation = {
  address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  reputation: 3,
  releasedCount: 3,
  totalEarned: 450,
  level: 'trusted',
  isFirstTime: false,
};

const firstTime: ContributorReputation = {
  address: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK',
  reputation: null,
  releasedCount: 0,
  totalEarned: 0,
  level: null,
  isFirstTime: true,
};

describe('ContributorReputationBadge (#1459)', () => {
  it('shows completed count, level, and earnings for a returning contributor', () => {
    render(<ContributorReputationBadge reputation={returning} />);

    expect(screen.getByText('3 bounties completed')).toBeInTheDocument();
    expect(screen.getByText('Trusted contributor')).toBeInTheDocument();
    expect(screen.getByText(/450 earned/)).toBeInTheDocument();
  });

  it('uses the singular noun for a single completed bounty', () => {
    render(
      <ContributorReputationBadge
        reputation={{ ...returning, reputation: 1, releasedCount: 1, level: 'rising' }}
      />
    );

    expect(screen.getByText('1 bounty completed')).toBeInTheDocument();
  });

  it('renders nothing for a first-time contributor instead of a misleading zero', () => {
    const { container } = render(<ContributorReputationBadge reputation={firstTime} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the lookup is loading', () => {
    const { container } = render(<ContributorReputationBadge reputation={null} loading />);
    expect(container).toBeEmptyDOMElement();
  });
});
