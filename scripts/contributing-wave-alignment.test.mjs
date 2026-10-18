import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1377: Docs: confirm CONTRIBUTING.md reflects the current wave/backlog structure
// Asserts contribution instructions match wave docs and point to canonical process.

test('ISSUE-1377: CONTRIBUTING.md exists and reflects current wave backlog structure', () => {
  const docPath = join(process.cwd(), 'CONTRIBUTING.md');
  assert.ok(existsSync(docPath), 'CONTRIBUTING.md must exist');

  const content = readFileSync(docPath, 'utf8');
  assert.match(
    content,
    /## How to Contribute \(Canonical Process\)/,
    'CONTRIBUTING.md must contain How to Contribute (Canonical Process) section'
  );
  assert.match(content, /docs\/wave-4\.md/, 'CONTRIBUTING.md must link to wave-4 backlog');
  assert.match(content, /docs\/wave-5\.md/, 'CONTRIBUTING.md must link to wave-5 backlog');
  assert.match(content, /docs\/wave-6\.md/, 'CONTRIBUTING.md must link to wave-6 backlog');
});

test('ISSUE-1377: CONTRIBUTING.md defines single canonical contribution workflow matching wave docs', () => {
  const content = readFileSync(join(process.cwd(), 'CONTRIBUTING.md'), 'utf8');
  assert.match(
    content,
    /Resolves #<issue-number>/,
    'CONTRIBUTING.md must specify canonical PR linking instruction'
  );
  assert.match(content, /Issue #1377/, 'CONTRIBUTING.md must reference Issue #1377 reconciliation');
});
