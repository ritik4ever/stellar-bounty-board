import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1293: Frontend: add test coverage for `index.css`
// Asserts test coverage for conditional branches and user interactions using Testing Library and user-event.

test('ISSUE-1293: frontend/src/index.css.test.tsx exists', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'index.css.test.tsx');
  assert.ok(existsSync(testPath), 'frontend/src/index.css.test.tsx must exist');
});

test('ISSUE-1293: index.css.test.tsx imports Testing Library and user-event', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'index.css.test.tsx'),
    'utf8'
  );
  assert.match(content, /@testing-library\/react/, 'must import @testing-library/react');
  assert.match(content, /@testing-library\/user-event/, 'must import @testing-library/user-event');
});

test('ISSUE-1293: index.css.test.tsx tests user interactions via user-event', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'index.css.test.tsx'),
    'utf8'
  );
  assert.match(content, /userEvent\.setup\(\)/, 'must set up userEvent');
  assert.match(content, /user\.click\(/, 'must simulate user click interactions');
  assert.match(content, /user\.tab\(\)/, 'must simulate user keyboard tab navigation');
});

test('ISSUE-1293: index.css.test.tsx covers conditional branches (theme and bulk states)', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'index.css.test.tsx'),
    'utf8'
  );
  assert.match(content, /data-theme/, 'must test data-theme conditional branching');
  assert.match(
    content,
    /disabled/,
    'must test disabled conditional branching for interactive elements'
  );
});

test('ISSUE-1293: assertions target DOM elements rather than implementation details', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'index.css.test.tsx'),
    'utf8'
  );
  assert.match(content, /getByRole/, 'must query accessible DOM roles');
  assert.match(
    content,
    /toHaveFocus|toBeDisabled|toBeEnabled/,
    'must assert DOM interactive states'
  );
});
