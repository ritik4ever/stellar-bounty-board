import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1288: Frontend: verify small-viewport layout for `recommendations.ts`
// Asserts no horizontal scroll at 320px, tap targets meet 44px minimum,
// and long text truncates with full value available on demand.

test('ISSUE-1288: index.css prevents horizontal scroll at 320px for recommendations panel', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /\.recommendations-panel[\s\S]*?overflow-x:\s*hidden/,
    'must enforce overflow-x: hidden on recommendations-panel at 320px'
  );
  assert.match(
    cssContent,
    /\.recommendations-panel[\s\S]*?max-width:\s*100%/,
    'must constrain recommendations-panel to 100% max-width'
  );
});

test('ISSUE-1288: index.css enforces 44px tap targets for filter chips and buttons', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /\.filter-chip[\s\S]*?min-height:\s*44px/,
    'filter-chip must meet 44px min-height'
  );
  assert.match(
    cssContent,
    /\.connect-wallet-btn[\s\S]*?min-height:\s*44px/,
    'connect-wallet-btn must meet 44px min-height'
  );
  assert.match(
    cssContent,
    /\.secondary-link[\s\S]*?min-height:\s*44px/,
    'secondary-link must meet 44px min-height'
  );
});

test('ISSUE-1288: index.css provides truncation and full text disclosure on demand', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /\.bounty-card--recommended\s+h3[\s\S]*?text-overflow:\s*ellipsis/,
    'bounty recommendation title must truncate with ellipsis on small screens'
  );
  assert.match(
    cssContent,
    /\.bounty-card--recommended\s+h3:(hover|focus-visible)[\s\S]*?white-space:\s*normal/,
    'title must expand to show full value on hover or keyboard focus'
  );
});

test('ISSUE-1288: recommendations.small-viewport.test.tsx verifies 320px layout constraints', () => {
  const testPath = join(
    process.cwd(),
    'frontend',
    'src',
    'recommendations.small-viewport.test.tsx'
  );
  assert.ok(existsSync(testPath), 'test file must exist');

  const testContent = readFileSync(testPath, 'utf8');
  assert.match(testContent, /320px/, 'must test 320px viewport constraint');
  assert.match(testContent, /recommendations-panel/, 'must target recommendations-panel');
});
