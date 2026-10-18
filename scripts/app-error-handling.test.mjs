import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1299: Backend: tighten error handling in `app.ts`
// Asserts external failures are wrapped in typed errors, original cause is preserved for logging,
// and no raw dependency error reaches a response body.

test('ISSUE-1299: backend/src/app.ts imports typed dependency errors and internal error message', () => {
  const appContent = readFileSync(join(process.cwd(), 'backend', 'src', 'app.ts'), 'utf8');

  assert.match(appContent, /ServiceDependencyError/, 'app.ts must import ServiceDependencyError');
  assert.match(
    appContent,
    /MiddlewareDependencyError/,
    'app.ts must import MiddlewareDependencyError'
  );
  assert.match(appContent, /INTERNAL_ERROR_MESSAGE/, 'app.ts must import INTERNAL_ERROR_MESSAGE');
});

test('ISSUE-1299: sendError in app.ts handles ServiceDependencyError and preserves cause for logging', () => {
  const appContent = readFileSync(join(process.cwd(), 'backend', 'src', 'app.ts'), 'utf8');

  assert.match(
    appContent,
    /if\s*\(\s*error instanceof ServiceDependencyError\s*\)/,
    'sendError must inspect ServiceDependencyError'
  );
  assert.match(
    appContent,
    /err:\s*error\.cause/,
    'sendError must preserve original cause for logging'
  );
  assert.match(
    appContent,
    /['"]service_dependency_failure['"]/,
    'sendError must log service_dependency_failure'
  );
  assert.match(
    appContent,
    /jsonError\(res,\s*req,\s*error\.statusCode,\s*error\.publicMessage\)/,
    'sendError must respond with publicMessage and status'
  );
});

test('ISSUE-1299: sendError detects raw leak patterns and sanitizes response to INTERNAL_ERROR_MESSAGE', () => {
  const appContent = readFileSync(join(process.cwd(), 'backend', 'src', 'app.ts'), 'utf8');

  assert.match(appContent, /containsRawLeak/, 'app.ts must define raw leak detector');
  assert.match(
    appContent,
    /RAW_LEAK_PATTERNS/,
    'app.ts must maintain pattern list for raw driver/fs leaks'
  );
  assert.match(
    appContent,
    /statusCode\s*>=\s*500\s*\|\|\s*containsRawLeak/,
    'sendError must intercept 500s and raw leaks'
  );
  assert.match(
    appContent,
    /INTERNAL_ERROR_MESSAGE/,
    'sendError must sanitize raw leak response to INTERNAL_ERROR_MESSAGE'
  );
});
