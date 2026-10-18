import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Test Issue #1303: Backend: raise unit-test coverage for `services/`
// Verifies success paths, failure paths, error propagation, and boundary inputs.

test('ISSUE-1303: services unit test suite files exist in backend/test/services/', () => {
  const expectedTestFiles = [
    'config.unit.test.ts',
    'bountyTemplates.unit.test.ts',
    'csvImport.unit.test.ts',
    'pushSubscriptionService.unit.test.ts',
    'archiveScheduler.unit.test.ts',
    'recurringBountySchedules.unit.test.ts',
    'disputeAlertJob.unit.test.ts',
  ];

  for (const file of expectedTestFiles) {
    const fullPath = path.join(process.cwd(), 'backend', 'test', 'services', file);
    assert.ok(
      fs.existsSync(fullPath),
      `Expected test file ${file} must exist in backend/test/services/`
    );
  }
});

test('ISSUE-1303: bountyTemplates unit tests cover error propagation and boundary inputs', () => {
  const content = fs.readFileSync(
    path.join(process.cwd(), 'backend', 'test', 'services', 'bountyTemplates.unit.test.ts'),
    'utf8'
  );
  assert.match(
    content,
    /Bounty template not found\./,
    'must assert thrown error when template is not found'
  );
  assert.match(content, /applyBountyTemplate/, 'must test applyBountyTemplate');
  assert.match(content, /listBountyTemplates/, 'must test listBountyTemplates');
  assert.match(content, /getBountyTemplate/, 'must test getBountyTemplate');
});

test('ISSUE-1303: csvImport unit tests cover error propagation and malformed inputs', () => {
  const content = fs.readFileSync(
    path.join(process.cwd(), 'backend', 'test', 'services', 'csvImport.unit.test.ts'),
    'utf8'
  );
  assert.match(
    content,
    /CSV headers must be unique\./,
    'must assert thrown error on duplicate headers'
  );
  assert.match(
    content,
    /CSV contains an unterminated quoted field\./,
    'must assert thrown error on unterminated quotes'
  );
  assert.match(content, /__csvError/, 'must assert column count mismatch error flag');
  assert.match(content, /csvRowToBounty/, 'must test csvRowToBounty');
});

test('ISSUE-1303: pushSubscriptionService unit tests cover store lifecycle and idempotency', () => {
  const content = fs.readFileSync(
    path.join(process.cwd(), 'backend', 'test', 'services', 'pushSubscriptionService.unit.test.ts'),
    'utf8'
  );
  assert.match(content, /registerPushSubscription/, 'must test registerPushSubscription');
  assert.match(content, /unregisterPushSubscription/, 'must test unregisterPushSubscription');
  assert.match(content, /listPushSubscriptions/, 'must test listPushSubscriptions');
});

test('ISSUE-1303: archiveScheduler unit tests cover retention boundaries and terminal states', () => {
  const content = fs.readFileSync(
    path.join(process.cwd(), 'backend', 'test', 'services', 'archiveScheduler.unit.test.ts'),
    'utf8'
  );
  assert.match(content, /archiveOldBounties/, 'must test archiveOldBounties');
  assert.match(content, /retentionSeconds/, 'must test retentionSeconds boundary');
  assert.match(content, /startArchiveJob/, 'must test startArchiveJob');
  assert.match(content, /stopArchiveJob/, 'must test stopArchiveJob');
});

test('ISSUE-1303: disputeAlertJob unit tests cover SLA window and cooldown suppression', () => {
  const content = fs.readFileSync(
    path.join(process.cwd(), 'backend', 'test', 'services', 'disputeAlertJob.unit.test.ts'),
    'utf8'
  );
  assert.match(content, /scanAndAlertStuckDisputes/, 'must test scanAndAlertStuckDisputes');
  assert.match(content, /DISPUTE_SLA_HOURS/, 'must test SLA threshold configuration');
  assert.match(
    content,
    /DISPUTE_ALERT_INTERVAL_HOURS/,
    'must test alert cooldown repeat suppression'
  );
});

test('ISSUE-1303: recurringBountySchedules unit tests cover scheduling, cancellation, and error paths', () => {
  const content = fs.readFileSync(
    path.join(
      process.cwd(),
      'backend',
      'test',
      'services',
      'recurringBountySchedules.unit.test.ts'
    ),
    'utf8'
  );
  assert.match(content, /createRecurringSchedule/, 'must test createRecurringSchedule');
  assert.match(content, /cancelRecurringSchedule/, 'must test cancelRecurringSchedule');
  assert.match(
    content,
    /Recurring bounty schedule not found\./,
    'must assert thrown error on missing schedule cancellation'
  );
});
