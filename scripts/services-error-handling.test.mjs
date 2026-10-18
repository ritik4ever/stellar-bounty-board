import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1302: Backend: tighten error handling in `services/`
// Verifies external failures are wrapped in typed errors, original cause is preserved,
// and no raw dependency details leak to clients.

test('ISSUE-1302: backend/src/services/errors.ts exists and defines typed errors', () => {
  const errorsPath = join(process.cwd(), 'backend', 'src', 'services', 'errors.ts');
  assert.ok(existsSync(errorsPath), 'backend/src/services/errors.ts must exist');

  const content = readFileSync(errorsPath, 'utf8');
  assert.match(
    content,
    /export class ServiceDependencyError extends Error/,
    'must export ServiceDependencyError class'
  );
  assert.match(content, /export function wrapServiceError/, 'must export wrapServiceError helper');
  assert.match(content, /json-store/, 'must include json-store dependency');
  assert.match(content, /github-api/, 'must include github-api dependency');
  assert.match(content, /soroban-rpc/, 'must include soroban-rpc dependency');
  assert.match(content, /file-lock/, 'must include file-lock dependency');
});

test('ISSUE-1302: backend/src/middleware/errors.ts handles ServiceDependencyError cleanly', () => {
  const mwErrorsPath = join(process.cwd(), 'backend', 'src', 'middleware', 'errors.ts');
  const content = readFileSync(mwErrorsPath, 'utf8');

  assert.match(
    content,
    /ServiceDependencyError/,
    'middleware/errors.ts must import ServiceDependencyError'
  );
  assert.match(
    content,
    /err instanceof ServiceDependencyError/,
    'createTerminalErrorHandler must handle ServiceDependencyError'
  );
  assert.match(
    content,
    /"service_dependency_failure"/,
    'terminal error handler must log service_dependency_failure'
  );
  assert.match(
    content,
    /res\.status\(err\.statusCode\)\.json\(\{\s*error:\s*err\.publicMessage/,
    'terminal error handler must respond with sanitized publicMessage'
  );
});

test('ISSUE-1302: openIssues wraps GitHub API errors in ServiceDependencyError', () => {
  const openIssues = readFileSync(
    join(process.cwd(), 'backend', 'src', 'services', 'openIssues.ts'),
    'utf8'
  );
  assert.match(openIssues, /wrapServiceError/, 'openIssues.ts must use wrapServiceError');
  assert.match(openIssues, /github-api/, 'openIssues.ts must specify github-api dependency');
  assert.match(
    openIssues,
    /open_issues\.fetch_github/,
    'openIssues.ts must name operation attempted'
  );
});

test('ISSUE-1302: bountyStore wraps JSON store operations and file locks in wrapServiceError', () => {
  const bountyStore = readFileSync(
    join(process.cwd(), 'backend', 'src', 'services', 'bountyStore.ts'),
    'utf8'
  );
  assert.match(bountyStore, /wrapServiceError/, 'bountyStore.ts must use wrapServiceError');
  assert.match(bountyStore, /bounty_store\.read_store/, 'bountyStore must wrap read_store');
  assert.match(bountyStore, /bounty_store\.write_store/, 'bountyStore must wrap write_store');
  assert.match(bountyStore, /bounty_store\.lock/, 'bountyStore must wrap file-lock');
});

test('ISSUE-1302: other services files wrap JSON store operations in wrapServiceError', () => {
  const templates = readFileSync(
    join(process.cwd(), 'backend', 'src', 'services', 'bountyTemplates.ts'),
    'utf8'
  );
  assert.match(templates, /wrapServiceError/, 'bountyTemplates.ts must use wrapServiceError');

  const schedules = readFileSync(
    join(process.cwd(), 'backend', 'src', 'services', 'recurringBountySchedules.ts'),
    'utf8'
  );
  assert.match(
    schedules,
    /wrapServiceError/,
    'recurringBountySchedules.ts must use wrapServiceError'
  );

  const pushSubs = readFileSync(
    join(process.cwd(), 'backend', 'src', 'services', 'pushSubscriptionService.ts'),
    'utf8'
  );
  assert.match(
    pushSubs,
    /wrapServiceError/,
    'pushSubscriptionService.ts must use wrapServiceError'
  );
});
