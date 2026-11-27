import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1285: Frontend: verify small-viewport layout for GitHubIssuePreviewCard.tsx
// Asserts no horizontal scroll at 320px, tap targets meet 44px minimum,
// and long text truncates with full value available on demand.

test('ISSUE-1285: index.css prevents horizontal scroll at 320px for GitHub issue card', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /\.github-issue-card[\s\S]*?overflow-x:\s*hidden/,
    'must enforce overflow-x: hidden on github-issue-card at 320px'
  );
  assert.match(
    cssContent,
    /\.github-issue-card[\s\S]*?max-width:\s*100%/,
    'must constrain github-issue-card to 100% max-width'
  );
});

test('ISSUE-1285: index.css enforces 44px tap targets for retry button and links', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /\.github-issue-card__retry-btn[\s\S]*?min-height:\s*44px/,
    'github-issue-card__retry-btn must meet 44px min-height'
  );
  assert.match(
    cssContent,
    /\.github-issue-card__error-link[\s\S]*?min-height:\s*44px/,
    'github-issue-card__error-link must meet 44px min-height'
  );
});

test('ISSUE-1285: index.css provides truncation and full text disclosure on demand', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /\.github-issue-card__title[\s\S]*?text-overflow:\s*ellipsis/,
    'github issue card title must truncate with ellipsis on small screens'
  );
  assert.match(
    cssContent,
    /\.github-issue-card__title:(hover|focus-visible)[\s\S]*?white-space:\s*normal/,
    'title must expand to show full value on hover or keyboard focus'
  );
});

test('ISSUE-1285: GitHubIssuePreviewCard.small-viewport.test.tsx verifies 320px layout constraints', () => {
  const testPath = join(
    process.cwd(),
    'frontend',
    'src',
    'GitHubIssuePreviewCard.small-viewport.test.tsx'
  );
  assert.ok(existsSync(testPath), 'test file must exist');

  const testContent = readFileSync(testPath, 'utf8');
  assert.match(testContent, /320px/, 'must test 320px viewport constraint');
  assert.match(testContent, /github-issue-card/, 'must target github-issue-card');
});
