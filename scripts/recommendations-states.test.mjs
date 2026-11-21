import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1289: Frontend: add loading and error states to `recommendations.ts`
// Asserts loading, empty, and error states are visually distinct, error offers retry,
// and all states are covered by automated tests.

test('ISSUE-1289: recommendations.ts exports fetch state and status types', () => {
  const tsContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'recommendations.ts'),
    'utf8'
  );
  assert.match(
    tsContent,
    /export type RecommendationStatus/,
    'must export RecommendationStatus type'
  );
  assert.match(
    tsContent,
    /export interface RecommendationFetchState/,
    'must export RecommendationFetchState interface'
  );
});

test('ISSUE-1289: RecommendedBounties.tsx accepts error and onRetry props and renders error state', () => {
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
});

test('ISSUE-1289: loading, empty, and error states are covered in recommendations.states.test.tsx', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'recommendations.states.test.tsx');
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
