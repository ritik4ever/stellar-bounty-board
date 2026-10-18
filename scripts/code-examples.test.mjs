import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

test('ISSUE-1367: CODE_EXAMPLES.md exists and reflects current wave backlog structure', () => {
  const filePath = join(process.cwd(), 'CODE_EXAMPLES.md');
  assert.ok(existsSync(filePath), 'CODE_EXAMPLES.md must exist');

  const content = readFileSync(filePath, 'utf8');
  assert.match(
    content,
    /## Wave & Backlog Alignment/,
    'CODE_EXAMPLES.md must contain Wave & Backlog Alignment section'
  );
  assert.match(content, /docs\/wave-4\.md/, 'CODE_EXAMPLES.md must link to wave-4 backlog');
  assert.match(content, /docs\/wave-5\.md/, 'CODE_EXAMPLES.md must link to wave-5 backlog');
  assert.match(content, /docs\/wave-6\.md/, 'CODE_EXAMPLES.md must link to wave-6 backlog');
});

test('ISSUE-1367: CODE_EXAMPLES.md defines single canonical contribution workflow', () => {
  const content = readFileSync(join(process.cwd(), 'CODE_EXAMPLES.md'), 'utf8');
  assert.match(
    content,
    /### Canonical Contribution Process/,
    'CODE_EXAMPLES.md must specify canonical process'
  );
  assert.match(content, /CONTRIBUTING\.md/, 'CODE_EXAMPLES.md must link to CONTRIBUTING.md');
  assert.match(content, /issue #1367/, 'CODE_EXAMPLES.md must reference issue #1367');
});
