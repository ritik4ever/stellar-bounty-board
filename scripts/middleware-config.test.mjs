import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

test('ISSUE-1304: backend/src/middleware/config.ts exists and defines MiddlewareConfig interface', () => {
  const configPath = join(process.cwd(), 'backend', 'src', 'middleware', 'config.ts');
  assert.ok(existsSync(configPath), 'backend/src/middleware/config.ts must exist');

  const content = readFileSync(configPath, 'utf8');
  assert.match(
    content,
    /export interface MiddlewareConfig/,
    'config.ts must export MiddlewareConfig interface'
  );
  assert.match(
    content,
    /export function getMiddlewareConfig/,
    'config.ts must export getMiddlewareConfig function'
  );
  assert.match(content, /defaultBodyLimit/, 'config.ts must include defaultBodyLimit');
  assert.match(content, /largeBodyLimit/, 'config.ts must include largeBodyLimit');
  assert.match(content, /idempotencyTtlMs/, 'config.ts must include idempotencyTtlMs');
  assert.match(
    content,
    /idempotencyCleanupIntervalMs/,
    'config.ts must include idempotencyCleanupIntervalMs'
  );
  assert.match(content, /maintainerRateLimit/, 'config.ts must include maintainerRateLimit');
  assert.match(content, /maintainerLockRetries/, 'config.ts must include maintainerLockRetries');
});

test('ISSUE-1304: bodyLimit, idempotency, and maintainerLimiter consume getMiddlewareConfig', () => {
  const bodyLimit = readFileSync(
    join(process.cwd(), 'backend', 'src', 'middleware', 'bodyLimit.ts'),
    'utf8'
  );
  assert.match(bodyLimit, /getMiddlewareConfig/, 'bodyLimit.ts must use getMiddlewareConfig');

  const idempotency = readFileSync(
    join(process.cwd(), 'backend', 'src', 'middleware', 'idempotency.ts'),
    'utf8'
  );
  assert.match(idempotency, /getMiddlewareConfig/, 'idempotency.ts must use getMiddlewareConfig');

  const limiter = readFileSync(
    join(process.cwd(), 'backend', 'src', 'middleware', 'maintainerLimiter.ts'),
    'utf8'
  );
  assert.match(limiter, /getMiddlewareConfig/, 'maintainerLimiter.ts must use getMiddlewareConfig');
});

test('ISSUE-1304: backend/src/index.ts logs effective middleware configuration at startup', () => {
  const indexContent = readFileSync(join(process.cwd(), 'backend', 'src', 'index.ts'), 'utf8');
  assert.match(indexContent, /getMiddlewareConfig/, 'index.ts must import getMiddlewareConfig');
  assert.match(indexContent, /"middleware_config"/, 'index.ts must log middleware_config');
});

test('ISSUE-1304: .env.example documents all operational middleware constants with defaults', () => {
  const envContent = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
  assert.match(envContent, /DEFAULT_BODY_LIMIT/, '.env.example must document DEFAULT_BODY_LIMIT');
  assert.match(envContent, /LARGE_BODY_LIMIT/, '.env.example must document LARGE_BODY_LIMIT');
  assert.match(envContent, /IDEMPOTENCY_TTL_MS/, '.env.example must document IDEMPOTENCY_TTL_MS');
  assert.match(
    envContent,
    /IDEMPOTENCY_CLEANUP_INTERVAL_MS/,
    '.env.example must document IDEMPOTENCY_CLEANUP_INTERVAL_MS'
  );
  assert.match(
    envContent,
    /MAINTAINER_LOCK_RETRIES/,
    '.env.example must document MAINTAINER_LOCK_RETRIES'
  );
});
