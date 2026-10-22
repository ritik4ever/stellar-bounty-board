import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test: Accessibility pass on `types.ts`
// Asserts zero critical/serious axe violations, keyboard operability, and automated a11y tests.

test('types.ts exports getAccessibleAsyncStateAnnouncement', () => {
  const content = readFileSync(join(process.cwd(), 'frontend', 'src', 'types.ts'), 'utf8');

  assert.match(
    content,
    /export function getAccessibleAsyncStateAnnouncement/,
    'must export getAccessibleAsyncStateAnnouncement'
  );
});

test('types.a11y.test.tsx verifies axe compliance and keyboard navigation', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'types.a11y.test.tsx');
  assert.ok(existsSync(testPath), 'test file must exist');

  const testContent = readFileSync(testPath, 'utf8');
  assert.match(
    testContent,
    /axe\(.+?\)/,
    'test suite must run axe automated accessibility check'
  );
  assert.match(
    testContent,
    /toHaveNoViolations\(\)/,
    'test suite must assert zero axe accessibility violations'
  );
  assert.match(testContent, /user\.tab\(\)/, 'test suite must test keyboard tab navigation');
  assert.match(
    testContent,
    /user\.keyboard\(/,
    'test suite must test keyboard activation'
  );
});
