import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #14: Add status tooltips and glossary
// Acceptance criteria:
// 1. Statuses include explanatory UI help (tooltips on pills and action buttons)
// 2. Status glossary component explains open, reserved, submitted, released, refunded, expired, disputed
// 3. Keep copy concise and beginner-friendly
// 4. Readable on desktop and mobile without layout issues
// 5. Copy is consistent across pages

test('ISSUE-14: frontend/src/StatusGlossary.tsx exists and defines glossary dialog', () => {
  const glossaryPath = join(process.cwd(), 'frontend', 'src', 'StatusGlossary.tsx');
  assert.ok(existsSync(glossaryPath), 'StatusGlossary.tsx must exist');

  const content = readFileSync(glossaryPath, 'utf8');
  assert.match(
    content,
    /export default function StatusGlossary/,
    'Must export StatusGlossary component'
  );
  assert.match(
    content,
    /data-testid="status-glossary-dialog"/,
    'Must define status-glossary-dialog testid'
  );
  assert.match(content, /data-testid="close-glossary-btn"/, 'Must define close-glossary-btn');

  // Verify all statuses are explained
  const requiredStatuses = [
    'open',
    'reserved',
    'submitted',
    'released',
    'refunded',
    'expired',
    'disputed',
  ];
  for (const status of requiredStatuses) {
    assert.match(
      content,
      new RegExp(`glossary-item-\\$\{status\}`),
      `Must explain ${status} status`
    );
  }

  // Verify key actions are explained
  const requiredActions = ['reserve', 'submit', 'release', 'refund'];
  for (const action of requiredActions) {
    assert.match(content, new RegExp(action, 'i'), `Must explain ${action} action`);
  }
});

test('ISSUE-14: BountyCard.tsx implements explanatory status pill tooltip and aria-label', () => {
  const cardPath = join(process.cwd(), 'frontend', 'src', 'BountyCard.tsx');
  assert.ok(existsSync(cardPath), 'BountyCard.tsx must exist');

  const content = readFileSync(cardPath, 'utf8');
  assert.match(
    content,
    /title=\{`\$\{statusCopy\[bounty\.status\]\?\.label\}:\s*\$\{statusCopy\[bounty\.status\]\?\.description\}`\}/,
    'Status pill must include explanatory description in title tooltip'
  );
  assert.match(
    content,
    /aria-label=\{`Status:\s*\$\{statusCopy\[bounty\.status\]\?\.label\}\.\s*\$\{statusCopy\[bounty\.status\]\?\.description\}`\}/,
    'Status pill must provide accessible aria-label'
  );
  assert.match(content, /data-testid="bounty-card-status-pill"/, 'Status pill must have testid');
});

test('ISSUE-14: App.tsx wires StatusGlossary, header trigger, and filter tooltips', () => {
  const appPath = join(process.cwd(), 'frontend', 'src', 'App.tsx');
  assert.ok(existsSync(appPath), 'App.tsx must exist');

  const content = readFileSync(appPath, 'utf8');

  // Verify glossary integration
  assert.match(
    content,
    /import StatusGlossary from '\.\/StatusGlossary'/,
    'Imports StatusGlossary'
  );
  assert.match(content, /<StatusGlossary/, 'Renders StatusGlossary component');
  assert.match(
    content,
    /data-testid="header-status-glossary-btn"/,
    'Header contains glossary button'
  );
  assert.match(
    content,
    /data-testid="status-glossary-toggle"/,
    'Filter toolbar contains status guide trigger'
  );

  // Verify filter chips tooltips
  assert.match(
    content,
    /title=\{status === 'all' \? 'Show all bounty statuses' : \(statusCopy\[status\]\?\.description \|\| status\)\}/,
    'Filter chips must have descriptive title tooltips'
  );

  // Verify action button tooltips
  assert.match(content, /title=\{action\.title\}/, 'Action buttons must have title tooltips');
  assert.match(
    content,
    /data-testid=\{`action-button-\$\{action\.action\}`\}/,
    'Action buttons must have testid'
  );
});

test('ISSUE-14: constants.ts defines concise copy and descriptions for all statuses and actions', () => {
  const constantsPath = join(process.cwd(), 'frontend', 'src', 'constants.ts');
  assert.ok(existsSync(constantsPath), 'constants.ts must exist');

  const content = readFileSync(constantsPath, 'utf8');
  assert.match(content, /export const statusCopy/, 'Must export statusCopy');
  assert.match(content, /export const actionCopy/, 'Must export actionCopy');
  assert.match(content, /export const statusGlossary/, 'Must export statusGlossary');
});
