import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

test('ISSUE-1380: SECURITY.md exists and reflects current wave backlog structure', () => {
  const secPath = join(process.cwd(), 'SECURITY.md');
  assert.ok(existsSync(secPath), 'SECURITY.md must exist');

  const content = readFileSync(secPath, 'utf8');
  assert.match(
    content,
    /## Wave & Backlog Alignment/,
    'SECURITY.md must contain Wave & Backlog Alignment section'
  );
  assert.match(content, /docs\/wave-4\.md/, 'SECURITY.md must link to wave-4 backlog');
  assert.match(content, /docs\/wave-5\.md/, 'SECURITY.md must link to wave-5 backlog');
  assert.match(content, /docs\/wave-6\.md/, 'SECURITY.md must link to wave-6 backlog');
});

test('ISSUE-1380: SECURITY.md defines single canonical contribution workflow', () => {
  const content = readFileSync(join(process.cwd(), 'SECURITY.md'), 'utf8');
  assert.match(
    content,
    /### Canonical Contribution Process/,
    'SECURITY.md must specify canonical process'
  );
  assert.match(content, /CONTRIBUTING\.md/, 'SECURITY.md must link to CONTRIBUTING.md');
  assert.match(content, /Issue #1380/, 'SECURITY.md must reference Issue #1380');
});
