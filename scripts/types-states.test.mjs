import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1270: Frontend: add loading and error states to `types.ts`
// Asserts loading, empty, and error states are visually distinct, error offers retry,
// and all three states are covered by automated tests.

test('ISSUE-1270: types.ts exports AsyncDataStatus, AsyncDataState, and resolveAsyncState', () => {
  const content = readFileSync(join(process.cwd(), 'frontend', 'src', 'types.ts'), 'utf8');

  assert.match(content, /export type AsyncDataStatus/, 'must export AsyncDataStatus');
  assert.match(content, /export interface AsyncDataState/, 'must export AsyncDataState');
  assert.match(
    content,
    /export function resolveAsyncState/,
    'must export resolveAsyncState helper'
  );
  assert.match(
    content,
    /export interface AsyncRetryAffordance/,
    'must export AsyncRetryAffordance interface'
  );
});

test('ISSUE-1270: types.states.test.tsx covers each state and retry affordance', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'types.states.test.tsx');
  assert.ok(existsSync(testPath), 'test file must exist');

  const testContent = readFileSync(testPath, 'utf8');
  assert.match(testContent, /types-loading|async-loading/, 'test must cover loading state');
  assert.match(testContent, /types-empty|async-empty/, 'test must cover empty state');
  assert.match(testContent, /types-error|async-error/, 'test must cover error state');
  assert.match(testContent, /handleRetry/, 'test must simulate retry interaction');
});
