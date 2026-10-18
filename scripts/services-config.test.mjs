import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

test('ISSUE-1301: backend/src/services/config.ts exists and defines ServicesConfig interface', () => {
  const configPath = join(process.cwd(), 'backend', 'src', 'services', 'config.ts');
  assert.ok(existsSync(configPath), 'backend/src/services/config.ts must exist');

  const content = readFileSync(configPath, 'utf8');
  assert.match(
    content,
    /export interface ServicesConfig/,
    'config.ts must export ServicesConfig interface'
  );
  assert.match(
    content,
    /export function getServicesConfig/,
    'config.ts must export getServicesConfig function'
  );
  assert.match(
    content,
    /bountyListCacheTtlSeconds/,
    'config.ts must include bountyListCacheTtlSeconds'
  );
  assert.match(
    content,
    /globalMetricsCacheTtlSeconds/,
    'config.ts must include globalMetricsCacheTtlSeconds'
  );
  assert.match(content, /openIssuesCacheTtlMs/, 'config.ts must include openIssuesCacheTtlMs');
  assert.match(content, /openIssuesDefaultRepo/, 'config.ts must include openIssuesDefaultRepo');
  assert.match(content, /archiveJobIntervalMs/, 'config.ts must include archiveJobIntervalMs');
  assert.match(
    content,
    /expirationJobIntervalMs/,
    'config.ts must include expirationJobIntervalMs'
  );
  assert.match(content, /disputeAlertIntervalMs/, 'config.ts must include disputeAlertIntervalMs');
  assert.match(
    content,
    /recurringSchedulerIntervalMs/,
    'config.ts must include recurringSchedulerIntervalMs'
  );
});

test('ISSUE-1301: services files consume getServicesConfig', () => {
  const bountyStore = readFileSync(
    join(process.cwd(), 'backend', 'src', 'services', 'bountyStore.ts'),
    'utf8'
  );
  assert.match(bountyStore, /getServicesConfig/, 'bountyStore.ts must use getServicesConfig');

  const openIssues = readFileSync(
    join(process.cwd(), 'backend', 'src', 'services', 'openIssues.ts'),
    'utf8'
  );
  assert.match(openIssues, /getServicesConfig/, 'openIssues.ts must use getServicesConfig');

  const expirationJob = readFileSync(
    join(process.cwd(), 'backend', 'src', 'services', 'reservationExpirationJob.ts'),
    'utf8'
  );
  assert.match(
    expirationJob,
    /getServicesConfig/,
    'reservationExpirationJob.ts must use getServicesConfig'
  );

  const disputeJob = readFileSync(
    join(process.cwd(), 'backend', 'src', 'services', 'disputeAlertJob.ts'),
    'utf8'
  );
  assert.match(disputeJob, /getServicesConfig/, 'disputeAlertJob.ts must use getServicesConfig');

  const recurringJob = readFileSync(
    join(process.cwd(), 'backend', 'src', 'services', 'recurringBountySchedules.ts'),
    'utf8'
  );
  assert.match(
    recurringJob,
    /getServicesConfig/,
    'recurringBountySchedules.ts must use getServicesConfig'
  );
});

test('ISSUE-1301: backend/src/index.ts logs effective services configuration at startup', () => {
  const indexContent = readFileSync(join(process.cwd(), 'backend', 'src', 'index.ts'), 'utf8');
  assert.match(indexContent, /getServicesConfig/, 'index.ts must import getServicesConfig');
  assert.match(indexContent, /"services_config"/, 'index.ts must log services_config');
});

test('ISSUE-1301: .env.example documents all operational services constants with defaults', () => {
  const envContent = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
  assert.match(
    envContent,
    /BOUNTY_LIST_CACHE_TTL_SECONDS/,
    '.env.example must document BOUNTY_LIST_CACHE_TTL_SECONDS'
  );
  assert.match(
    envContent,
    /GLOBAL_METRICS_CACHE_TTL_SECONDS/,
    '.env.example must document GLOBAL_METRICS_CACHE_TTL_SECONDS'
  );
  assert.match(
    envContent,
    /OPEN_ISSUES_CACHE_TTL_MS/,
    '.env.example must document OPEN_ISSUES_CACHE_TTL_MS'
  );
  assert.match(
    envContent,
    /ARCHIVE_JOB_INTERVAL_MS/,
    '.env.example must document ARCHIVE_JOB_INTERVAL_MS'
  );
  assert.match(
    envContent,
    /RESERVATION_EXPIRATION_INTERVAL_MS/,
    '.env.example must document RESERVATION_EXPIRATION_INTERVAL_MS'
  );
  assert.match(
    envContent,
    /DISPUTE_ALERT_JOB_INTERVAL_MS/,
    '.env.example must document DISPUTE_ALERT_JOB_INTERVAL_MS'
  );
  assert.match(
    envContent,
    /RECURRING_SCHEDULER_INTERVAL_MS/,
    '.env.example must document RECURRING_SCHEDULER_INTERVAL_MS'
  );
});
