import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';
import * as logger from './logger';

function Bomb(): JSX.Element {
  throw new Error('boom');
}

test('shows fallback UI and logs error when child throws', async () => {
  const spy = vi.spyOn(logger, 'logError');

  render(
    <ErrorBoundary componentName="TestComponent">
      <Bomb />
    </ErrorBoundary>
  );

  expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  const button = screen.getByRole('button', { name: /Try again/i });
  expect(button).toBeInTheDocument();
  expect(spy).toHaveBeenCalledWith('TestComponent', expect.any(Error));

  await userEvent.click(button);
  expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
});
