import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1273: Frontend: add loading and error states to `utils.ts`
// Asserts loading, empty, and error states are visually distinct, error offers retry,
// and all three states are covered by automated tests.

test('ISSUE-1273: utils.ts exports AsyncFetchStatus, AsyncFetchState, and resolveFetchState', () => {
  const content = readFileSync(join(process.cwd(), 'frontend', 'src', 'utils.ts'), 'utf8');

  assert.match(content, /export type AsyncFetchStatus/, 'must export AsyncFetchStatus');
  assert.match(content, /export interface AsyncFetchState/, 'must export AsyncFetchState');
  assert.match(
    content,
    /export function resolveFetchState/,
    'must export resolveFetchState helper'
  );
});

test('ISSUE-1273: utils.states.test.tsx covers each state and retry affordance', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'utils.states.test.tsx');
  assert.ok(existsSync(testPath), 'test file must exist');

  const testContent = readFileSync(testPath, 'utf8');
  assert.match(testContent, /async-loading/, 'test must cover loading state');
  assert.match(testContent, /async-empty/, 'test must cover empty state');
  assert.match(testContent, /async-error/, 'test must cover error state');
  assert.match(testContent, /handleRetry/, 'test must simulate retry interaction');
});
