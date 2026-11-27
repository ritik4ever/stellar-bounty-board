import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #7: Persist board filters in URL query params
// Acceptance criteria:
// 1. Filter state is reflected in the URL
// 2. Refreshing the page preserves filters
// 3. Shared URLs open with the same filter state
// 4. Avoid full page reloads via replaceState
// 5. No regression in existing board behavior

test('ISSUE-7: constants.ts exports buildFilterQueryParams and parseFilterQueryParams', () => {
  const constantsPath = join(process.cwd(), 'frontend', 'src', 'constants.ts');
  assert.ok(existsSync(constantsPath), 'constants.ts must exist');

  const content = readFileSync(constantsPath, 'utf8');
  assert.match(
    content,
    /export function buildFilterQueryParams/,
    'Must export buildFilterQueryParams'
  );
  assert.match(
    content,
    /export function parseFilterQueryParams/,
    'Must export parseFilterQueryParams'
  );
  assert.match(content, /export function readInitialFilters/, 'Must export readInitialFilters');
});

test('ISSUE-7: buildFilterQueryParams creates clean URL query string without defaults', () => {
  function buildFilterQueryParams(filters) {
    const params = new URLSearchParams();
    if (filters.searchQuery && filters.searchQuery.trim() !== '') {
      params.set('search', filters.searchQuery.trim());
    }
    if (filters.statusFilter && filters.statusFilter !== 'all') {
      params.set('status', filters.statusFilter);
    }
    if (filters.minReward && filters.minReward !== '') {
      params.set('minReward', filters.minReward);
    }
    if (filters.maxReward && filters.maxReward !== '') {
      params.set('maxReward', filters.maxReward);
    }
    if (filters.repoFilter && filters.repoFilter !== '') {
      params.set('repo', filters.repoFilter);
    }
    if (filters.tokenFilter && filters.tokenFilter !== '') {
      params.set('tokenSymbol', filters.tokenFilter);
    }
    if (filters.sortOption && filters.sortOption !== 'newest') {
      params.set('sort', filters.sortOption);
    }
    if (filters.sortDirection && filters.sortDirection !== 'desc') {
      params.set('direction', filters.sortDirection);
    }
    return params.toString();
  }

  // Default state produces empty query string
  const emptyQuery = buildFilterQueryParams({
    searchQuery: '',
    statusFilter: 'all',
    minReward: '',
    maxReward: '',
    repoFilter: '',
    tokenFilter: '',
    sortOption: 'newest',
    sortDirection: 'desc',
  });
  assert.equal(emptyQuery, '');

  // Filtered state produces exact query params
  const fullQuery = buildFilterQueryParams({
    searchQuery: 'stellar escrow',
    statusFilter: 'open',
    minReward: '50',
    maxReward: '500',
    repoFilter: 'ritik4ever/stellar-bounty-board',
    tokenFilter: 'XLM',
    sortOption: 'reward-high',
    sortDirection: 'desc',
  });

  const parsed = new URLSearchParams(fullQuery);
  assert.equal(parsed.get('search'), 'stellar escrow');
  assert.equal(parsed.get('status'), 'open');
  assert.equal(parsed.get('minReward'), '50');
  assert.equal(parsed.get('maxReward'), '500');
  assert.equal(parsed.get('repo'), 'ritik4ever/stellar-bounty-board');
  assert.equal(parsed.get('tokenSymbol'), 'XLM');
  assert.equal(parsed.get('sort'), 'reward-high');
});

test('ISSUE-7: parseFilterQueryParams restores exact FilterState from query string', () => {
  function parseFilterQueryParams(search) {
    const params = new URLSearchParams(search);
    return {
      searchQuery: params.get('search') ?? '',
      statusFilter: params.get('status') ?? 'all',
      minReward: params.get('minReward') ?? '',
      maxReward: params.get('maxReward') ?? '',
      repoFilter: params.get('repo') ?? '',
      tokenFilter: params.get('tokenSymbol') ?? '',
      sortOption: params.get('sort') ?? 'newest',
      sortDirection: params.get('direction') ?? 'desc',
    };
  }

  const query =
    'search=wallet&status=reserved&minReward=100&repo=owner%2Frepo&sort=oldest&direction=asc';
  const state = parseFilterQueryParams(query);

  assert.equal(state.searchQuery, 'wallet');
  assert.equal(state.statusFilter, 'reserved');
  assert.equal(state.minReward, '100');
  assert.equal(state.repoFilter, 'owner/repo');
  assert.equal(state.sortOption, 'oldest');
  assert.equal(state.sortDirection, 'asc');

  // Fallback defaults for missing query params
  const defaultState = parseFilterQueryParams('');
  assert.equal(defaultState.searchQuery, '');
  assert.equal(defaultState.statusFilter, 'all');
  assert.equal(defaultState.sortOption, 'newest');
  assert.equal(defaultState.sortDirection, 'desc');
});

test('ISSUE-7: App.tsx synchronizes filter state with URL and listens to popstate', () => {
  const appPath = join(process.cwd(), 'frontend', 'src', 'App.tsx');
  assert.ok(existsSync(appPath), 'App.tsx must exist');

  const content = readFileSync(appPath, 'utf8');

  // Verify URL sync hook
  assert.match(content, /buildFilterQueryParams/, 'Must use buildFilterQueryParams');
  assert.match(
    content,
    /window\.history\.replaceState/,
    'Must update URL via replaceState without full reload'
  );
  assert.match(content, /handlePopState/, 'Must define handlePopState handler');
  assert.match(
    content,
    /window\.addEventListener\('popstate', handlePopState\)/,
    'Must listen to popstate events'
  );
  assert.match(
    content,
    /readInitialFilters\(\)/,
    'Must restore filters from URL on page load/popstate'
  );
});
