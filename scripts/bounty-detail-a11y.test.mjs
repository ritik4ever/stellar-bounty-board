import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1278: Frontend: accessibility pass on `BountyDetailPage.tsx`
// Asserts zero critical/serious axe violations, keyboard operability, and automated a11y tests.

test('ISSUE-1278: BountyDetailPage.tsx exports getAccessibleBountyDetailLabel helper', () => {
  const tsContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'BountyDetailPage.tsx'),
    'utf8'
  );
  assert.match(
    tsContent,
    /export function getAccessibleBountyDetailLabel/,
    'must export getAccessibleBountyDetailLabel helper function'
  );
});

test('ISSUE-1278: BountyDetailPage.tsx implements accessible names and aria-hidden icons', () => {
  const componentContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'BountyDetailPage.tsx'),
    'utf8'
  );

  assert.match(
    componentContent,
    /aria-label=\{bounty \? getAccessibleBountyDetailLabel\(bounty\) : ['"]Bounty details['"]\}/,
    'detail panel must have accessible label'
  );
  assert.match(
    componentContent,
    /<Printer\s+size=\{16\}\s+aria-hidden="true"\s*\/>/,
    'decorative printer icon must have aria-hidden="true"'
  );
  assert.match(
    componentContent,
    /<Share2\s+size=\{16\}\s+aria-hidden="true"\s*\/>/,
    'decorative share icon must have aria-hidden="true"'
  );
  assert.match(
    componentContent,
    /<Clock\s+size=\{16\}\s+aria-hidden="true"\s*\/>/,
    'timeline clock icon must have aria-hidden="true"'
  );
  assert.match(
    componentContent,
    /aria-label="Go back to bounties list"/,
    'back button must have clear accessible label'
  );
  assert.match(
    componentContent,
    /aria-live="polite"/,
    'status announcement region must use aria-live polite'
  );
});

test('ISSUE-1278: BountyDetailPage.a11y.test.tsx verifies axe compliance and keyboard navigation', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'BountyDetailPage.a11y.test.tsx');
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
});
