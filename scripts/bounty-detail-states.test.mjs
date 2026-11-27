import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1276: Frontend: add loading and error states to `BountyDetailPage.tsx`
// Asserts loading, empty, and error states are visually distinct, error offers retry,
// and all three states are covered by automated tests.

test('ISSUE-1276: BountyDetailPage.tsx implements explicit loading state', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'BountyDetailPage.tsx'),
    'utf8'
  );

  assert.match(content, /bounty-detail--loading/, 'must define loading modifier class');
  assert.match(content, /aria-busy="true"/, 'loading state must declare aria-busy="true"');
  assert.match(
    content,
    /data-testid="bounty-detail-loading"/,
    'must declare test id for loading state'
  );
});

test('ISSUE-1276: BountyDetailPage.tsx implements explicit empty state', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'BountyDetailPage.tsx'),
    'utf8'
  );

  assert.match(content, /bounty-detail--empty/, 'must render empty state modifier class');
  assert.match(
    content,
    /role="status"/,
    'empty state must declare role="status" for screen reader announcements'
  );
  assert.match(
    content,
    /data-testid="bounty-detail-empty"/,
    'must declare test id for empty state'
  );
});

test('ISSUE-1276: BountyDetailPage.tsx implements error state with retry affordance', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'BountyDetailPage.tsx'),
    'utf8'
  );

  assert.match(content, /bounty-detail--error/, 'must define error modifier class');
  assert.match(content, /role="alert"/, 'error state must declare role="alert"');
  assert.match(content, /bounty-detail__retry-btn/, 'must provide retry button affordance');
  assert.match(
    content,
    /data-testid="bounty-detail-error"/,
    'must declare test id for error state'
  );
});

test('ISSUE-1276: BountyDetailPage.test.tsx covers each state and retry affordance', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'BountyDetailPage.test.tsx');
  assert.ok(existsSync(testPath), 'test file must exist');

  const testContent = readFileSync(testPath, 'utf8');
  assert.match(testContent, /bounty-detail-loading/, 'test must cover loading state');
  assert.match(testContent, /bounty-detail-empty/, 'test must cover empty state');
  assert.match(testContent, /handleRetry/, 'test must simulate retry interaction');
});
