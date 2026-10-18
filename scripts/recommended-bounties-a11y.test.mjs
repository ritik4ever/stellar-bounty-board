import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1281: Frontend: accessibility pass on `RecommendedBounties.tsx`
// Asserts zero critical/serious axe violations, keyboard operability, and automated a11y tests.

test('ISSUE-1281: frontend/src/RecommendedBounties.a11y.test.tsx exists', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'RecommendedBounties.a11y.test.tsx');
  assert.ok(existsSync(testPath), 'RecommendedBounties.a11y.test.tsx must exist');
});

test('ISSUE-1281: RecommendedBounties.a11y.test.tsx asserts axe compliance and keyboard operation', () => {
  const testContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'RecommendedBounties.a11y.test.tsx'),
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
  assert.match(
    testContent,
    /user\.keyboard\('\{Enter\}'\)/,
    'must test keyboard button activation'
  );
});

test('ISSUE-1281: RecommendedBounties.tsx implements accessible names, roles, and live announcements', () => {
  const componentContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'RecommendedBounties.tsx'),
    'utf8'
  );

  assert.match(
    componentContent,
    /role="group"\s+aria-label="Filter recommendations by skill tag"/,
    'tag filter group must provide accessible label'
  );
  assert.match(
    componentContent,
    /aria-pressed=\{activeTag === tag\}/,
    'filter chips must declare aria-pressed state'
  );
  assert.match(
    componentContent,
    /<Star\s+size=\{18\}\s+aria-hidden="true"\s*\/>/,
    'decorative star icon must be aria-hidden'
  );
  assert.match(
    componentContent,
    /aria-live="polite"/,
    'status announcement region must declare aria-live polite'
  );
});
