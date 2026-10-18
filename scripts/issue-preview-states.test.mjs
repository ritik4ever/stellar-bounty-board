import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1286: Frontend: add loading and error states to `GitHubIssuePreviewCard.tsx`
// Asserts loading, empty, and error states are visually distinct, error offers retry,
// and all three states are covered by automated tests.

test('ISSUE-1286: GitHubIssuePreviewCard.tsx implements explicit loading state', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'GitHubIssuePreviewCard.tsx'),
    'utf8'
  );

  assert.match(content, /github-issue-card--loading/, 'must define loading modifier class');
  assert.match(content, /aria-busy="true"/, 'loading state must declare aria-busy="true"');
});

test('ISSUE-1286: GitHubIssuePreviewCard.tsx implements explicit empty state', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'GitHubIssuePreviewCard.tsx'),
    'utf8'
  );

  assert.match(content, /github-issue-card__empty/, 'must render empty state message container');
  assert.match(
    content,
    /role="status"/,
    'empty state must declare role="status" for screen reader announcements'
  );
});

test('ISSUE-1286: GitHubIssuePreviewCard.tsx implements error state with retry affordance', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'GitHubIssuePreviewCard.tsx'),
    'utf8'
  );

  assert.match(content, /github-issue-card--error/, 'must define error modifier class');
  assert.match(content, /role="alert"/, 'error state must declare role="alert"');
  assert.match(content, /github-issue-card__retry-btn/, 'must provide retry button affordance');
});

test('ISSUE-1286: GitHubIssuePreviewCard.test.tsx covers each state and retry affordance', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'GitHubIssuePreviewCard.test.tsx');
  assert.ok(existsSync(testPath), 'test file must exist');

  const testContent = readFileSync(testPath, 'utf8');
  assert.match(testContent, /github-issue-preview-loading/, 'test must cover loading state');
  assert.match(testContent, /No issue data available/, 'test must cover empty state');
  assert.match(testContent, /handleRetry/, 'test must simulate retry interaction');
});
