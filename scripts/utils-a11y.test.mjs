import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1275: Frontend: accessibility pass on `utils.ts`
// Asserts zero critical/serious axe violations, keyboard operability, and automated a11y tests.

test('ISSUE-1275: utils.ts exports getAccessibleFilterAnnouncement and getAccessibleBountySummary', () => {
  const content = readFileSync(join(process.cwd(), 'frontend', 'src', 'utils.ts'), 'utf8');

  assert.match(
    content,
    /export function getAccessibleFilterAnnouncement/,
    'must export getAccessibleFilterAnnouncement'
  );
  assert.match(
    content,
    /export function getAccessibleBountySummary/,
    'must export getAccessibleBountySummary'
  );
});

test('ISSUE-1275: utils.a11y.test.tsx verifies axe compliance and keyboard navigation', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'utils.a11y.test.tsx');
  assert.ok(existsSync(testPath), 'test file must exist');

  const testContent = readFileSync(testPath, 'utf8');
  assert.match(
    testContent,
    /axe\(container\)/,
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
    /user\.keyboard\('\{Enter\}'\)/,
    'test suite must test keyboard activation'
  );
});
