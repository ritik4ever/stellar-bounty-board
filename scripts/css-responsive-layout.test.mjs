import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1295: Frontend: verify small-viewport layout for `index.css`
// Asserts no horizontal scroll at 320px, tap targets meet 44px minimum,
// and long text truncates with full value available on demand.

test('ISSUE-1295: frontend/src/index.css exists', () => {
  const cssPath = join(process.cwd(), 'frontend', 'src', 'index.css');
  assert.ok(existsSync(cssPath), 'frontend/src/index.css must exist');
});

test('ISSUE-1295: index.css contains small-viewport media queries for <= 480px and 320px', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /@media\s*\(max-width:\s*480px\)/,
    'index.css must include media query for <= 480px mobile viewports'
  );
  assert.match(
    cssContent,
    /@media\s*\(max-width:\s*320px\)/,
    'index.css must include media query for 320px narrow phone viewports'
  );
});

test('ISSUE-1295: index.css prevents horizontal scroll at 320px', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /overflow-x:\s*hidden/,
    'must set overflow-x: hidden to prevent horizontal scroll'
  );
  assert.match(cssContent, /max-width:\s*100vw/, 'must constrain root width to viewport');
  assert.match(cssContent, /overflow-wrap:\s*anywhere/, 'must allow long words to wrap anywhere');
});

test('ISSUE-1295: index.css enforces 44px minimum tap targets for touch accessibility', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /min-height:\s*44px/,
    'touch interactive elements must have min-height: 44px'
  );
  assert.match(
    cssContent,
    /min-width:\s*44px/,
    'touch interactive elements must have min-width: 44px'
  );
});

test('ISSUE-1295: index.css supports text truncation with full value available on demand', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /text-overflow:\s*ellipsis/,
    'must truncate overflow text with ellipsis'
  );
  assert.match(
    cssContent,
    /:hover|:focus-visible/,
    'must expose full text on hover or focus-visible'
  );
});
