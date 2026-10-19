import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1455: Add a maintainer dashboard view separate from the public bounty list
// Acceptance criteria:
// 1. Maintainer view filters to bounties they created
// 2. Sorted by urgency of required action (new submissions, pending disputes first)
// 3. Distinct from the general public browse view

test('ISSUE-1455: frontend/src/MaintainerDashboard.tsx exists and exports components and urgency sorters', () => {
  const componentPath = join(process.cwd(), 'frontend', 'src', 'MaintainerDashboard.tsx');
  assert.ok(existsSync(componentPath), 'MaintainerDashboard.tsx must exist');

  const content = readFileSync(componentPath, 'utf8');
  assert.match(
    content,
    /export default function MaintainerDashboard/,
    'must export MaintainerDashboard component'
  );
  assert.match(
    content,
    /export function getActionUrgencyScore/,
    'must export getActionUrgencyScore'
  );
  assert.match(
    content,
    /export function sortBountiesByActionUrgency/,
    'must export sortBountiesByActionUrgency'
  );
});

test('ISSUE-1455: Urgency scoring prioritizes submitted and disputed bounties first', () => {
  const componentPath = join(process.cwd(), 'frontend', 'src', 'MaintainerDashboard.tsx');
  const content = readFileSync(componentPath, 'utf8');

  // Verify that submitted and disputed have higher scores than reserved, open, released
  assert.match(content, /case ['"]submitted['"]:\s*return 100/);
  assert.match(content, /case ['"]disputed['"]:\s*return 90/);
  assert.match(content, /case ['"]reserved['"]:\s*return 50/);
  assert.match(content, /case ['"]open['"]:\s*return 20/);
});

test('ISSUE-1455: Maintainer view filters to bounties created by maintainer', () => {
  const componentPath = join(process.cwd(), 'frontend', 'src', 'MaintainerDashboard.tsx');
  const content = readFileSync(componentPath, 'utf8');

  assert.match(
    content,
    /b\.maintainer\.toLowerCase\(\)\s*===\s*activeAddress\.toLowerCase\(\)/,
    'must filter bounties by maintainer address'
  );
  assert.match(
    content,
    /maintainer-dashboard__address-filter/,
    'must allow filtering by maintainer address'
  );
});

test('ISSUE-1455: Maintainer view renders distinct urgency badges and action controls', () => {
  const componentPath = join(process.cwd(), 'frontend', 'src', 'MaintainerDashboard.tsx');
  const content = readFileSync(componentPath, 'utf8');

  assert.match(content, /urgency-badge--action/, 'must render urgency badge for reviews');
  assert.match(content, /urgency-badge--dispute/, 'must render urgency badge for disputes');
  assert.match(content, /maintainer-btn-release/, 'must render direct approval button');
  assert.match(content, /maintainer-btn-refund/, 'must render direct refund button');
});

test('ISSUE-1455: App.tsx incorporates view switcher toggle and renders MaintainerDashboard', () => {
  const appPath = join(process.cwd(), 'frontend', 'src', 'App.tsx');
  const content = readFileSync(appPath, 'utf8');

  assert.match(
    content,
    /import MaintainerDashboard from '\.\/MaintainerDashboard'/,
    'App.tsx must import MaintainerDashboard'
  );
  assert.match(content, /dashboard-view-switcher/, 'App.tsx must render view switcher navigation');
  assert.match(
    content,
    /viewMode === ['"]maintainer['"]\s*\?\s*\(\s*<MaintainerDashboard/,
    'App.tsx must conditionally render MaintainerDashboard'
  );
});

test('ISSUE-1455: index.css provides dedicated styles for MaintainerDashboard and View Switcher', () => {
  const cssPath = join(process.cwd(), 'frontend', 'src', 'index.css');
  const content = readFileSync(cssPath, 'utf8');

  assert.match(
    content,
    /\.dashboard-view-switcher/,
    'index.css must style .dashboard-view-switcher'
  );
  assert.match(content, /\.maintainer-dashboard/, 'index.css must style .maintainer-dashboard');
  assert.match(
    content,
    /\.maintainer-card--needs-action/,
    'index.css must highlight cards needing action'
  );
  assert.match(content, /\.urgency-badge--action/, 'index.css must style action urgency badges');
});
