import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1294: Frontend: accessibility pass on `index.css`
// Asserts zero critical/serious axe violations, keyboard operability, and automated a11y tests.

test('ISSUE-1294: frontend/src/index.css.a11y.test.tsx exists', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'index.css.a11y.test.tsx');
  assert.ok(existsSync(testPath), 'index.css.a11y.test.tsx must exist');
});

test('ISSUE-1294: index.css.a11y.test.tsx asserts axe compliance and keyboard operation', () => {
  const testContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'index.css.a11y.test.tsx'),
    'utf8'
  );

  assert.match(
    testContent,
    /axe\(container\)/,
    'must execute axe accessibility audit against rendered container'
  );
  assert.match(
    testContent,
    /toHaveNoViolations\(\)/,
    'must assert zero critical/serious axe violations'
  );
  assert.match(testContent, /user\.tab\(\)/, 'must test keyboard tab navigation');
});

test('ISSUE-1294: index.css implements accessible focus-visible outlines and sr-only utility', () => {
  const cssContent = readFileSync(join(process.cwd(), 'frontend', 'src', 'index.css'), 'utf8');

  assert.match(
    cssContent,
    /:focus-visible/,
    'index.css must declare explicit :focus-visible rules for interactives'
  );
  assert.match(
    cssContent,
    /\.sr-only[\s\S]*?position:\s*absolute[\s\S]*?clip:\s*rect/,
    'index.css must define standard .sr-only accessible screen-reader clipping'
  );
});
