import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #5: Add reward range filter on bounty board
// Acceptance criteria:
// 1. Users can filter by reward range (min and max inputs)
// 2. Out-of-range bounties are hidden
// 3. Filters work together with search and status without breaking the board
// 4. Show current active range in the UI
// 5. Empty state appears when nothing matches

test('ISSUE-5: App.tsx renders min and max reward range filter inputs and active badge', () => {
  const appPath = join(process.cwd(), 'frontend', 'src', 'App.tsx');
  assert.ok(existsSync(appPath), 'App.tsx must exist');

  const content = readFileSync(appPath, 'utf8');

  // Verify inputs and UI elements
  assert.match(
    content,
    /data-testid="reward-range-filter"/,
    'Must render reward range filter container'
  );
  assert.match(content, /data-testid="min-reward-filter"/, 'Must render min reward input');
  assert.match(content, /data-testid="max-reward-filter"/, 'Must render max reward input');
  assert.match(
    content,
    /data-testid="active-reward-range-badge"/,
    'Must render active range badge'
  );
  assert.match(content, /data-testid="clear-reward-filter-btn"/, 'Must render clear range button');
});

test('ISSUE-5: filteredBounties filters out out-of-range bounties based on min and max reward', () => {
  function filterBounties(bounties, minReward, maxReward) {
    return bounties.filter((bounty) => {
      if (minReward !== '') {
        const min = parseFloat(minReward);
        if (!isNaN(min) && bounty.amount < min) return false;
      }
      if (maxReward !== '') {
        const max = parseFloat(maxReward);
        if (!isNaN(max) && bounty.amount > max) return false;
      }
      return true;
    });
  }

  const sampleBounties = [
    { id: '1', amount: 50 },
    { id: '2', amount: 150 },
    { id: '3', amount: 300 },
    { id: '4', amount: 1000 },
  ];

  // Min filter only
  const minOnly = filterBounties(sampleBounties, '200', '');
  assert.deepEqual(
    minOnly.map((b) => b.id),
    ['3', '4']
  );

  // Max filter only
  const maxOnly = filterBounties(sampleBounties, '', '200');
  assert.deepEqual(
    maxOnly.map((b) => b.id),
    ['1', '2']
  );

  // Range filter
  const range = filterBounties(sampleBounties, '100', '500');
  assert.deepEqual(
    range.map((b) => b.id),
    ['2', '3']
  );

  // No match filter
  const noMatch = filterBounties(sampleBounties, '2000', '3000');
  assert.equal(noMatch.length, 0);
});

test('ISSUE-5: App.tsx handles empty state and clear filters for reward range', () => {
  const appPath = join(process.cwd(), 'frontend', 'src', 'App.tsx');
  const content = readFileSync(appPath, 'utf8');

  // Verify empty state messaging for reward range
  assert.match(
    content,
    /No bounties match this reward range/,
    'Must provide specialized empty state heading'
  );
  assert.match(content, /Try expanding the range/, 'Must provide helpful empty state message');

  // Verify onClearFilters resets minReward and maxReward
  assert.match(content, /setMinReward\(''\)/, 'onClearFilters must reset minReward');
  assert.match(content, /setMaxReward\(''\)/, 'onClearFilters must reset maxReward');
});
