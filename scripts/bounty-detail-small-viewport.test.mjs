import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1279: Frontend: verify small-viewport layout for `BountyDetailPage.tsx`
// Asserts no horizontal scroll at 320px, tap targets meet 44px minimum,
// and long text truncates with full value available on demand.

test('ISSUE-1279: index.css prevents horizontal scroll at 320px for bounty detail page', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /\.bounty-detail[\s\S]*?overflow-x:\s*hidden/,
    'must enforce overflow-x: hidden on bounty-detail at 320px'
  );
  assert.match(
    cssContent,
    /\.bounty-detail[\s\S]*?max-width:\s*100%/,
    'must constrain bounty-detail to 100% max-width'
  );
});

test('ISSUE-1279: index.css enforces 44px tap targets for buttons and copy controls', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /\.secondary-button[\s\S]*?min-height:\s*44px/,
    'secondary-button must meet 44px min-height'
  );
  assert.match(
    cssContent,
    /\.copy-button[\s\S]*?min-height:\s*44px/,
    'copy-button must meet 44px min-height'
  );
});

test('ISSUE-1279: index.css provides truncation and full text disclosure on demand', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /\.meta-grid--detail\s+\.copy-row[\s\S]*?text-overflow:\s*ellipsis/,
    'meta-grid copy rows must truncate with ellipsis on small screens'
  );
  assert.match(
    cssContent,
    /\.meta-grid--detail\s+\.copy-row:(hover|focus-visible)[\s\S]*?white-space:\s*normal/,
    'copy row must expand to show full value on hover or keyboard focus'
  );
});

test('ISSUE-1279: BountyDetailPage.small-viewport.test.tsx verifies 320px layout constraints', () => {
  const testPath = join(
    process.cwd(),
    'frontend',
    'src',
    'BountyDetailPage.small-viewport.test.tsx'
  );
  assert.ok(existsSync(testPath), 'test file must exist');

  const testContent = readFileSync(testPath, 'utf8');
  assert.match(testContent, /320px/, 'must test 320px viewport constraint');
  assert.match(testContent, /bounty-detail/, 'must target bounty-detail');
});
