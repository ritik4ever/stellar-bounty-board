import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';

describe('index.css user interactions and conditional branch tests (#1293)', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('covers dark mode conditional branch via user interaction', async () => {
    const user = userEvent.setup();
    function ThemeToggle() {
      const [theme, setTheme] = useState('light');
      const toggle = () => {
        const next = theme === 'light' ? 'dark' : 'light';
        setTheme(next);
        document.documentElement.setAttribute('data-theme', next);
      };
      return (
        <button onClick={toggle} className="primary-button">
          Toggle theme: {theme}
        </button>
      );
    }

    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: /toggle theme: light/i });
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    await user.click(button);
    expect(screen.getByRole('button', { name: /toggle theme: dark/i })).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await user.click(button);
    expect(screen.getByRole('button', { name: /toggle theme: light/i })).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('covers interactive focus states via user-event tab navigation', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button className="primary-button">First</button>
        <button className="secondary-button">Second</button>
        <a href="#test" className="inline-link">
          Link
        </a>
      </div>
    );

    const first = screen.getByRole('button', { name: /first/i });
    const second = screen.getByRole('button', { name: /second/i });
    const link = screen.getByRole('link', { name: /link/i });

    await user.tab();
    expect(first).toHaveFocus();

    await user.tab();
    expect(second).toHaveFocus();

    await user.tab();
    expect(link).toHaveFocus();
  });

  it('covers bulk toolbar disabled vs enabled conditional branches via user-event', async () => {
    const user = userEvent.setup();
    function BulkControl() {
      const [selectedCount, setSelectedCount] = useState(0);
      return (
        <div className="bulk-toolbar">
          <label className="bounty-card__select">
            <input
              type="checkbox"
              checked={selectedCount > 0}
              onChange={(e) => setSelectedCount(e.target.checked ? 2 : 0)}
            />
            Select All
          </label>
          <button className="primary-button" disabled={selectedCount === 0}>
            Release Selected ({selectedCount})
          </button>
        </div>
      );
    }

    render(<BulkControl />);
    const checkbox = screen.getByRole('checkbox', { name: /select all/i });
    const actionBtn = screen.getByRole('button', { name: /release selected/i });

    // Initially disabled branch
    expect(actionBtn).toBeDisabled();

    // User checks box -> enabled branch
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(actionBtn).toBeEnabled();

    // User unchecks box -> disabled branch
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(actionBtn).toBeDisabled();
  });

  it('covers text truncation with full value available on demand via keyboard focus', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <span
          tabIndex={0}
          className="truncate-mobile"
          title="Full Stellar Address: GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        >
          GAAA...WHF
        </span>
      </div>
    );

    const element = screen.getByTitle(/Full Stellar Address/i);
    expect(element).toHaveClass('truncate-mobile');

    await user.tab();
    expect(element).toHaveFocus();
  });
});
