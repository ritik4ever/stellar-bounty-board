import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1374: Docs: confirm IMPLEMENTATION_SUMMARY.md reflects the current wave/backlog structure
// Asserts contribution instructions match wave docs and point to canonical process.

test('ISSUE-1374: IMPLEMENTATION_SUMMARY.md exists and reflects current wave backlog structure', () => {
  const docPath = join(process.cwd(), 'IMPLEMENTATION_SUMMARY.md');
  assert.ok(existsSync(docPath), 'IMPLEMENTATION_SUMMARY.md must exist');

  const content = readFileSync(docPath, 'utf8');
  assert.match(
    content,
    /## Wave & Backlog Alignment/,
    'IMPLEMENTATION_SUMMARY.md must contain Wave & Backlog Alignment section'
  );
  assert.match(
    content,
    /docs\/wave-4\.md/,
    'IMPLEMENTATION_SUMMARY.md must link to wave-4 backlog'
  );
  assert.match(
    content,
    /docs\/wave-5\.md/,
    'IMPLEMENTATION_SUMMARY.md must link to wave-5 backlog'
  );
  assert.match(
    content,
    /docs\/wave-6\.md/,
    'IMPLEMENTATION_SUMMARY.md must link to wave-6 backlog'
  );
});

test('ISSUE-1374: IMPLEMENTATION_SUMMARY.md defines single canonical contribution workflow', () => {
  const content = readFileSync(join(process.cwd(), 'IMPLEMENTATION_SUMMARY.md'), 'utf8');
  assert.match(
    content,
    /### Canonical Contribution Process/,
    'IMPLEMENTATION_SUMMARY.md must specify canonical process'
  );
  assert.match(
    content,
    /CONTRIBUTING\.md/,
    'IMPLEMENTATION_SUMMARY.md must link to CONTRIBUTING.md'
  );
  assert.match(content, /Issue #1374/, 'IMPLEMENTATION_SUMMARY.md must reference Issue #1374');
});
