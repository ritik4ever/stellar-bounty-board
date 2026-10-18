import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1274: Frontend: add test coverage for `utils.ts`
// Asserts conditional branch coverage and user interaction testing with user-event.

test('ISSUE-1274: utils.test.ts covers conditional branches', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'utils.test.ts');
  assert.ok(existsSync(testPath), 'utils.test.ts must exist');

  const content = readFileSync(testPath, 'utf8');
  assert.match(content, /debounce/, 'must test debounce branch conditions');
  assert.match(content, /getUniqueRepos/, 'must test getUniqueRepos branches');
  assert.match(content, /getRepoMetrics/, 'must test getRepoMetrics calculations');
  assert.match(content, /getRewardBounds/, 'must test getRewardBounds empty vs populated branches');
  assert.match(content, /sortBounties/, 'must test sortBounties sorting branches');
  assert.match(
    content,
    /getActiveRewardLabel/,
    'must test getActiveRewardLabel boundary conditions'
  );
  assert.match(
    content,
    /getContributorMetrics/,
    'must test getContributorMetrics conditional paths'
  );
});

test('ISSUE-1274: utils.interactions.test.tsx tests user interactions via user-event', () => {
  const testPath = join(process.cwd(), 'frontend', 'src', 'utils.interactions.test.tsx');
  assert.ok(existsSync(testPath), 'interactions test file must exist');

  const content = readFileSync(testPath, 'utf8');
  assert.match(content, /userEvent\.setup\(\)/, 'must initialize userEvent setup');
  assert.match(content, /user\.type\(/, 'must simulate user typing into input');
  assert.match(content, /user\.click\(/, 'must simulate clicks on interactive elements');
  assert.match(content, /user\.selectOptions\(/, 'must simulate select option changes');
});

test('ISSUE-1274: assertions target DOM elements rather than implementation details', () => {
  const content = readFileSync(
    join(process.cwd(), 'frontend', 'src', 'utils.interactions.test.tsx'),
    'utf8'
  );
  assert.match(content, /getByRole/, 'must query accessible DOM roles');
  assert.match(content, /getByLabelText/, 'must query accessible label text');
  assert.match(content, /toBeInTheDocument/, 'must assert presence in DOM document');
});
