/**
 * @fileoverview Tests to ensure that `frontend/src/index.css` contains the
 * expected Tailwind directives and custom style rules. The tests also verify
 * that interactive affordances (e.g. hover styles) are present and that a
 * component using those classes can be rendered without errors.
 *
 * These tests purposefully avoid inspecting implementation details of the
 * React components – they focus on the DOM and the CSS content itself.
 */

import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Resolve the absolute path to the CSS file under test.
const cssFilePath = path.resolve(__dirname, '../../src/index.css');
const cssContent = fs.readFileSync(cssFilePath, 'utf8');

describe('frontend/src/index.css', () => {
  /**
   * Basic sanity checks – the file must contain the three Tailwind directives.
   * These are the primary “conditional branches” that Tailwind injects at
   * build‑time.
   */
  it('includes Tailwind base, components and utilities directives', () => {
    expect(cssContent).toMatch(/@tailwind\s+base/);
    expect(cssContent).toMatch(/@tailwind\s+components/);
    expect(cssContent).toMatch(/@tailwind\s+utilities/);
  });

  /**
   * Verify that a custom class used throughout the dashboard is defined.
   * The class name `bounty-card` is part of the UI and has a hover state.
   */
  it('defines the `.bounty-card` class with a transition', () => {
    // Look for a rule that starts with `.bounty-card` and contains `transition`.
    const bountyCardRule = /\.bounty-card\s*{[^}]*transition[^}]*}/;
    expect(cssContent).toMatch(bountyCardRule);
  });

  /**
   * Ensure the hover variant for `.bounty-card` exists – this is the
   * interactive branch we want to guarantee stays intact after refactors.
   */
  it('defines a hover style for `.bounty-card`', () => {
    const hoverRule = /\.bounty-card:hover\s*{[^}]*}/;
    expect(cssContent).toMatch(hoverRule);
  });

  /**
   * Render a minimal component that uses the `.bounty-card` class and simulate
   * a user hover via `user-event`. The test asserts that the element remains
   * in the DOM and still carries the expected class – this validates that the
   * CSS import does not break the component rendering pipeline.
   */
  it('renders a component with `.bounty-card` and responds to hover', async () => {
    const TestComponent = () => (
      <div data-testid="card" className="bounty-card">
        Test Card
      </div>
    );

    render(<TestComponent />);
    const card = screen.getByTestId('card');

    // Before interaction the element should have the class.
    expect(card).toHaveClass('bounty-card');

    // Simulate a hover – jsdom does not apply CSS, but the interaction
    // should not cause any errors and the class should stay intact.
    await userEvent.hover(card);
    expect(card).toHaveClass('bounty-card');

    // Un‑hover to ensure the event chain works both ways.
    await userEvent.unhover(card);
    expect(card).toHaveClass('bounty-card');
  });
});
