import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1298: Backend: audit app.ts for hardcoded values that belong in config
// Confirms operational constants are configurable, defaults are preserved,
// and effective values are logged at startup.

test('ISSUE-1298: backend/src/appConfig.ts exists and defines AppConfig interface', () => {
  const configPath = join(process.cwd(), 'backend', 'src', 'appConfig.ts');
  assert.ok(existsSync(configPath), 'backend/src/appConfig.ts must exist');

  const content = readFileSync(configPath, 'utf8');
  assert.match(
    content,
    /export interface AppConfig/,
    'appConfig.ts must export AppConfig interface'
  );
  assert.match(
    content,
    /export function getAppConfig/,
    'appConfig.ts must export getAppConfig function'
  );
  assert.match(content, /rateLimitWindowMs/, 'appConfig.ts must include rateLimitWindowMs');
  assert.match(content, /rateLimitReadMax/, 'appConfig.ts must include rateLimitReadMax');
  assert.match(content, /rateLimitMutationMax/, 'appConfig.ts must include rateLimitMutationMax');
  assert.match(content, /defaultPageSize/, 'appConfig.ts must include defaultPageSize');
  assert.match(content, /maxPageSize/, 'appConfig.ts must include maxPageSize');
  assert.match(
    content,
    /defaultLeaderboardLimit/,
    'appConfig.ts must include defaultLeaderboardLimit'
  );
  assert.match(content, /csvUploadLimit/, 'appConfig.ts must include csvUploadLimit');
  assert.match(content, /rawBodyLimit/, 'appConfig.ts must include rawBodyLimit');
  assert.match(
    content,
    /openIssuesCacheSeconds/,
    'appConfig.ts must include openIssuesCacheSeconds'
  );
  assert.match(
    content,
    /bountiesListCacheSeconds/,
    'appConfig.ts must include bountiesListCacheSeconds'
  );
  assert.match(content, /configCacheSeconds/, 'appConfig.ts must include configCacheSeconds');
  assert.match(
    content,
    /configStaleWhileRevalidateSeconds/,
    'appConfig.ts must include configStaleWhileRevalidateSeconds'
  );
});

test('ISSUE-1298: backend/src/app.ts consumes getAppConfig', () => {
  const appContent = readFileSync(join(process.cwd(), 'backend', 'src', 'app.ts'), 'utf8');
  assert.match(appContent, /getAppConfig/, 'app.ts must import getAppConfig');
  assert.match(appContent, /appConfig\.rateLimitWindowMs/, 'app.ts must use rateLimitWindowMs');
  assert.match(appContent, /appConfig\.rateLimitReadMax/, 'app.ts must use rateLimitReadMax');
  assert.match(
    appContent,
    /appConfig\.rateLimitMutationMax/,
    'app.ts must use rateLimitMutationMax'
  );
  assert.match(appContent, /appConfig\.rawBodyLimit/, 'app.ts must use rawBodyLimit');
  assert.match(appContent, /appConfig\.csvUploadLimit/, 'app.ts must use csvUploadLimit');
  assert.match(
    appContent,
    /appConfig\.openIssuesCacheSeconds/,
    'app.ts must use openIssuesCacheSeconds'
  );
  assert.match(
    appContent,
    /appConfig\.bountiesListCacheSeconds/,
    'app.ts must use bountiesListCacheSeconds'
  );
  assert.match(appContent, /appConfig\.configCacheSeconds/, 'app.ts must use configCacheSeconds');
});

test('ISSUE-1298: backend/src/index.ts logs effective app configuration at startup', () => {
  const indexContent = readFileSync(join(process.cwd(), 'backend', 'src', 'index.ts'), 'utf8');
  assert.match(indexContent, /getAppConfig/, 'index.ts must import getAppConfig');
  assert.match(indexContent, /"app_config"/, 'index.ts must log app_config');
});

test('ISSUE-1298: .env.example documents all operational app constants with defaults', () => {
  const envContent = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
  assert.match(envContent, /DEFAULT_PAGE_SIZE/, '.env.example must document DEFAULT_PAGE_SIZE');
  assert.match(envContent, /MAX_PAGE_SIZE/, '.env.example must document MAX_PAGE_SIZE');
  assert.match(
    envContent,
    /DEFAULT_LEADERBOARD_LIMIT/,
    '.env.example must document DEFAULT_LEADERBOARD_LIMIT'
  );
  assert.match(envContent, /CSV_UPLOAD_LIMIT/, '.env.example must document CSV_UPLOAD_LIMIT');
  assert.match(envContent, /RAW_BODY_LIMIT/, '.env.example must document RAW_BODY_LIMIT');
  assert.match(
    envContent,
    /OPEN_ISSUES_CACHE_SECONDS/,
    '.env.example must document OPEN_ISSUES_CACHE_SECONDS'
  );
  assert.match(
    envContent,
    /BOUNTIES_LIST_CACHE_SECONDS/,
    '.env.example must document BOUNTIES_LIST_CACHE_SECONDS'
  );
  assert.match(
    envContent,
    /CONFIG_CACHE_SECONDS/,
    '.env.example must document CONFIG_CACHE_SECONDS'
  );
  assert.match(
    envContent,
    /CONFIG_STALE_WHILE_REVALIDATE_SECONDS/,
    '.env.example must document CONFIG_STALE_WHILE_REVALIDATE_SECONDS'
  );
});
