import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1283: Frontend: add loading and error states to `RecommendedBounties.tsx`
// Asserts loading, empty, and error states are visually distinct, error offers retry,
// and all states are covered by automated tests.

test('ISSUE-1283: RecommendedBounties.tsx accepts error and onRetry props and renders distinct states', () => {
  const componentContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'RecommendedBounties.tsx'),
    'utf8'
  );

  assert.match(
    componentContent,
    /error\?: string \| Error \| null;/,
    'RecommendedBountiesProps must declare error prop'
  );
  assert.match(
    componentContent,
    /onRetry\?: \(\) => void;/,
    'RecommendedBountiesProps must declare onRetry callback prop'
  );
  assert.match(
    componentContent,
    /className="[^"]*error-state[^"]*"/,
    'component must render error-state container'
  );
  assert.match(
    componentContent,
    /error-state__retry/,
    'component must provide .error-state__retry retry affordance'
  );
  assert.match(
    componentContent,
    /bounty-card--skeleton/,
    'component must render skeleton cards during loading state'
  );
  assert.match(
    componentContent,
    /className="[^"]*empty-state[^"]*"/,
    'component must render empty-state container'
  );
});

test('ISSUE-1283: RecommendedBounties.states.test.tsx covers loading, empty, and error states', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'RecommendedBounties.states.test.tsx');
  assert.ok(existsSync(testPath), 'test file must exist');

  const testContent = readFileSync(testPath, 'utf8');
  assert.match(testContent, /aria-busy/, 'test must assert loading state visual attributes');
  assert.match(testContent, /empty-state/, 'test must assert empty state class and text');
  assert.match(testContent, /error-state/, 'test must assert error state role and class');
  assert.match(
    testContent,
    /user\.click\(retryBtn\)/,
    'test must simulate retry interaction with user-event'
  );
});
