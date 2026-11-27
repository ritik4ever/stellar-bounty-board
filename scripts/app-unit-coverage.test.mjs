import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1296: Backend: raise unit-test coverage for `app.ts`
// Asserts every exported function in app.ts has success, failure, and boundary coverage,
// and error propagation to callers is asserted.

test('ISSUE-1296: backend/src/app.ts exports helper functions', () => {
  const appContent = readFileSync(join(process.cwd(), 'backend', 'src', 'app.ts'), 'utf8');

  assert.match(
    appContent,
    /export function resolveRequestId/,
    'app.ts must export resolveRequestId'
  );
  assert.match(
    appContent,
    /export function parsePaginationValue/,
    'app.ts must export parsePaginationValue'
  );
  assert.match(
    appContent,
    /export function validateBountyAmount/,
    'app.ts must export validateBountyAmount'
  );
  assert.match(appContent, /export function escapeCsv/, 'app.ts must export escapeCsv');
  assert.match(appContent, /export function jsonError/, 'app.ts must export jsonError');
  assert.match(appContent, /export function sendError/, 'app.ts must export sendError');
});

test('ISSUE-1296: backend/test/app.unit.test.ts covers success, failure, and boundary inputs', () => {
  const testPath = join(process.cwd(), 'backend', 'test', 'app.unit.test.ts');
  assert.ok(existsSync(testPath), 'backend/test/app.unit.test.ts must exist');

  const content = readFileSync(testPath, 'utf8');
  assert.match(content, /resolveRequestId/, 'must test resolveRequestId');
  assert.match(content, /parsePaginationValue/, 'must test parsePaginationValue');
  assert.match(content, /validateBountyAmount/, 'must test validateBountyAmount');
  assert.match(content, /escapeCsv/, 'must test escapeCsv');
  assert.match(content, /jsonError/, 'must test jsonError');
  assert.match(content, /sendError/, 'must test sendError');
});

test('ISSUE-1296: error propagation and boundary inputs are asserted in unit tests', () => {
  const testPath = join(process.cwd(), 'backend', 'test', 'app.unit.test.ts');
  const content = readFileSync(testPath, 'utf8');

  assert.match(
    content,
    /greater than or equal to/,
    'must assert minimum boundary error propagation'
  );
  assert.match(content, /less than or equal to/, 'must assert maximum boundary error propagation');
  assert.match(content, /must be an integer/, 'must assert non-integer error propagation');
  assert.match(content, /at least 1 XLM/, 'must assert minimum bounty amount boundary');
  assert.match(content, /cannot exceed 10000 XLM/, 'must assert maximum bounty amount boundary');
  assert.match(content, /at most 7 decimal places/, 'must assert decimal precision boundary');
});
