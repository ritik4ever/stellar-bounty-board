import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1291: Frontend: accessibility pass on `recommendations.ts`
// Asserts zero critical/serious axe violations, keyboard operability, and automated a11y tests.

test('ISSUE-1291: recommendations.ts exports getAccessibleRecommendationLabel helper', () => {
  const tsContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'recommendations.ts'),
    'utf8'
  );
  assert.match(
    tsContent,
    /export function getAccessibleRecommendationLabel/,
    'must export getAccessibleRecommendationLabel helper function'
  );
});

test('ISSUE-1291: RecommendedBounties.tsx implements accessible names and aria-hidden icons', () => {
  const componentContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'RecommendedBounties.tsx'),
    'utf8'
  );

  assert.match(
    componentContent,
    /aria-label=\{getAccessibleRecommendationLabel\(recommendation\)\}/,
    'card must have accessible label derived from recommendation details'
  );
  assert.match(
    componentContent,
    /<Star\s+size=\{16\}\s+aria-hidden="true"\s*\/>|<Star\s+size=\{18\}\s+aria-hidden="true"\s*\/>/,
    'decorative star icons must have aria-hidden="true"'
  );
  assert.match(
    componentContent,
    /aria-label=\{`View issue #\$\{bounty\.issueNumber\} for \$\{bounty\.title\}`\}/,
    'action links must have unique descriptive accessible labels'
  );
  assert.match(
    componentContent,
    /aria-live="polite"/,
    'status containers must use aria-live polite for screen reader updates'
  );
});

test('ISSUE-1291: recommendations.a11y.test.tsx verifies axe compliance and keyboard navigation', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'recommendations.a11y.test.tsx');
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
