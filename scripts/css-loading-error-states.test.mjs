import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1292: Frontend: add loading and error states to `index.css`
// Asserts loading, empty, and error states are visually distinct, error offers retry,
// and all three states are covered by tests.

test('ISSUE-1292: frontend/src/index.css defines explicit loading state styles', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(cssContent, /\.loading-state/, 'must define .loading-state class');
  assert.match(cssContent, /\.loading-state__spinner/, 'must define .loading-state__spinner class');
  assert.match(cssContent, /@keyframes\s+state-spin/, 'must define spinner rotation keyframes');
  assert.match(cssContent, /\.loading-state__message/, 'must define .loading-state__message');
});

test('ISSUE-1292: frontend/src/index.css defines explicit error state styles with retry affordance', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(cssContent, /\.error-state/, 'must define .error-state class');
  assert.match(cssContent, /\.error-state__heading/, 'must define .error-state__heading');
  assert.match(cssContent, /\.error-state__message/, 'must define .error-state__message');
  assert.match(
    cssContent,
    /\.error-state__retry|\.retry-button/,
    'must define retry affordance class'
  );
});

test('ISSUE-1292: loading, empty, and error states are visually distinct', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  // Empty state has dashed border
  assert.match(cssContent, /dashed\s+var\(--line\)/, 'empty state must use dashed line border');

  // Loading state has spinning animation
  assert.match(
    cssContent,
    /animation:\s*state-spin/,
    'loading state must have spinning animation indicator'
  );

  // Error state has rose/alert accents
  assert.match(
    cssContent,
    /rgba\(184,\s*85,\s*75|--rose/,
    'error state must have distinct alert/rose accents'
  );
});

test('ISSUE-1292: frontend/src/index.css.states.test.tsx covers each state and retry affordance', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'index.css.states.test.tsx');
  assert.ok(existsSync(testPath), 'test file must exist');

  const testContent = readFileSync(testPath, 'utf8');
  assert.match(testContent, /loading-state/, 'test must cover explicit loading state');
  assert.match(testContent, /empty-state/, 'test must cover explicit empty state');
  assert.match(testContent, /error-state/, 'test must cover explicit error state');
  assert.match(
    testContent,
    /user\.click\(retryBtn\)|handleRetry/,
    'test must simulate retry interaction'
  );
});
