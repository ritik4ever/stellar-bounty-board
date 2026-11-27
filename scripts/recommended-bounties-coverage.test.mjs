import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1280: Frontend: add test coverage for RecommendedBounties.tsx
// Asserts conditional branches, user-event interactions, and DOM targeting.

test('ISSUE-1280: frontend/src/RecommendedBounties.test.tsx exists', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'RecommendedBounties.test.tsx');
  assert.ok(existsSync(testPath), 'RecommendedBounties.test.tsx must exist');
});

test('ISSUE-1280: RecommendedBounties.test.tsx covers conditional branches', () => {
  const testContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'RecommendedBounties.test.tsx'),
    'utf8'
  );

  assert.match(
    testContent,
    /walletConnected=\{false\}/,
    'must test walletConnected conditional branch'
  );
  assert.match(testContent, /error=\{/, 'must test error state conditional branches');
  assert.match(testContent, /loading=\{true\}/, 'must test loading state branch');
  assert.match(testContent, /recommendations=\{\[\]\}/, 'must test empty recommendations branch');
  assert.match(
    testContent,
    /days left|days overdue/,
    'must test relative deadline branch formatting'
  );
  assert.match(testContent, /XLM|USDC|OTHER/, 'must test UsdAmount token symbol branches');
});

test('ISSUE-1280: user interactions are tested via user-event rather than direct handlers', () => {
  const testContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'RecommendedBounties.test.tsx'),
    'utf8'
  );

  assert.match(
    testContent,
    /userEvent\.setup\(\)/,
    'must instantiate userEvent for testing user interactions'
  );
  assert.match(
    testContent,
    /await user\.click\(/,
    'must trigger interactions with user.click rather than direct prop execution'
  );
});

test('ISSUE-1280: assertions target the DOM rather than implementation details', () => {
  const testContent = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'RecommendedBounties.test.tsx'),
    'utf8'
  );

  assert.match(testContent, /screen\.getBy(Text|Role)/, 'must query rendered DOM nodes via screen');
  assert.doesNotMatch(
    testContent,
    /\.instance\(\)|\.state\(\)/,
    'must not inspect internal component state'
  );
});
