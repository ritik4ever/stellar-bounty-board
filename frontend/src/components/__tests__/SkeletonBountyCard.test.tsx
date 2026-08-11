import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SkeletonBountyCard from '../SkeletonBountyCard';

describe('SkeletonBountyCard', () => {
  it('should render without crashing', () => {
    render(<SkeletonBountyCard />);
    const skeletonCard = screen.getByTestId('skeleton-bounty-card');
    expect(skeletonCard).toBeInTheDocument();
  });

  it('should have aria-hidden attribute', () => {
    render(<SkeletonBountyCard />);
    const skeletonCard = screen.getByTestId('skeleton-bounty-card');
    expect(skeletonCard).toHaveAttribute('aria-hidden', 'true');
  });

  it('should contain pulse animation elements', () => {
    render(<SkeletonBountyCard />);
    const pulseElements = document.querySelectorAll('.skeleton-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });
});
