import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// Import App — if it fails, the test catches it
import App from './App';

describe('App component', () => {
  it('renders without crashing', () => {
    const { container } = render(<App />);
    expect(container).toBeDefined();
    expect(container.firstChild).not.toBeNull();
  });

  it('renders a root element', () => {
    const { container } = render(<App />);
    expect(container.children.length).toBeGreaterThan(0);
  });

  it('has some visible text content', () => {
    render(<App />);
    // The app should render SOME visible content
    const body = document.body;
    expect(body.textContent).toBeDefined();
    expect(body.textContent!.length).toBeGreaterThan(0);
  });
});

// Documented: 2026-10-01 — per issue #1261
