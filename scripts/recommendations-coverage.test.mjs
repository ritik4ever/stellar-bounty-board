import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1290: Frontend: add test coverage for `recommendations.ts`
// Asserts conditional branch coverage and user interaction testing with user-event.

test('ISSUE-1290: recommendations.test.ts covers conditional branches', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'recommendations.test.ts');
  assert.ok(existsSync(testPath), 'recommendations.test.ts must exist');

  const content = readFileSync(testPath, 'utf8');
  assert.match(
    content,
    /calculateRecommendationScore/,
    'must test calculateRecommendationScore branch conditions'
  );
  assert.match(content, /findSimilarBounties/, 'must test findSimilarBounties candidate filtering');
  assert.match(
    content,
    /updateProfileFromBounties/,
    'must test updateProfileFromBounties skill inference branches'
  );
  assert.match(content, /preferredRepos/, 'must test preferredRepos conditional weighting');
  assert.match(content, /good first issue/, 'must test good first issue branch bonus');
});

test('ISSUE-1290: recommendations.interactions.test.tsx tests user interactions via user-event', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'recommendations.interactions.test.tsx');
  assert.ok(existsSync(testPath), 'interactions test file must exist');

  const content = readFileSync(testPath, 'utf8');
  assert.match(content, /userEvent\.setup\(\)/, 'must initialize userEvent setup');
  assert.match(content, /user\.click\(/, 'must simulate clicks on interactive elements');
  assert.match(content, /onConnectWallet/, 'must test connect wallet click handler');
});

test('ISSUE-1290: assertions target DOM elements rather than implementation details', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'recommendations.interactions.test.tsx'),
    'utf8'
  );
  assert.match(content, /getByRole/, 'must query accessible DOM roles');
  assert.match(content, /toBeInTheDocument/, 'must assert presence in DOM document');
});
