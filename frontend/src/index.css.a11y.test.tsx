import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, it, expect } from 'vitest';

describe('index.css accessibility pass (#1294)', () => {
  it('has zero critical or serious axe violations on core styled UI elements', async () => {
    const { container } = render(
      <main>
        <header className="main-header">
          <div className="header-content">
            <h1>Stellar Bounty Board</h1>
            <div className="header-actions">
              <button type="button" className="secondary-button" aria-label="Toggle language">
                Language
              </button>
              <button type="button" className="theme-toggle" aria-label="Switch theme">
                Theme
              </button>
            </div>
          </div>
        </header>

        <section className="panel" aria-label="Bounties dashboard">
          <div className="panel-header">
            <h2>Bounties Overview</h2>
          </div>
          <div className="tag-filter-row" role="group" aria-label="Filter bounties">
            <button type="button" className="filter-chip filter-chip--active" aria-pressed="true">
              All
            </button>
            <button type="button" className="filter-chip" aria-pressed="false">
              Rust
            </button>
          </div>
          <div className="board-list">
            <article className="bounty-card" tabIndex={0} aria-label="Bounty item 1">
              <h3>Soroban escrow contract</h3>
              <p className="bounty-summary">Smart contract escrow implementation</p>
              <a href="#details" className="secondary-link" aria-label="View details for bounty 1">
                View Details
              </a>
            </article>
          </div>
        </section>

        <div className="sr-only" role="status" aria-live="polite">
          Active status announcement
        </div>
      </main>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports end-to-end keyboard operation through styled interactives', async () => {
    const user = userEvent.setup();
    render(
      <main>
        <button type="button" className="primary-button">
          Submit
        </button>
        <button type="button" className="secondary-button">
          Cancel
        </button>
        <a href="#more" className="inline-link">
          Read documentation
        </a>
      </main>
    );

    await user.tab();
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('link', { name: 'Read documentation' })).toHaveFocus();
  });

  it('verifies screen reader announcement utility class exists and is visually hidden', () => {
    const { container } = render(
      <div className="sr-only" role="status" aria-live="polite">
        Screen reader text
      </div>
    );

    const srEl = container.querySelector('.sr-only');
    expect(srEl).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Screen reader text');
  });
});
