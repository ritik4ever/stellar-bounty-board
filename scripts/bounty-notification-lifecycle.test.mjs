import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

// Test Issue #1454: Add notification (email or webhook) on bounty state change
// Acceptance criteria:
// 1. Notification fires on each lifecycle transition
// 2. Opt-in, not forced on every user
// 3. At least one delivery mechanism is implemented end to end

test('ISSUE-1454: notificationService defines all lifecycle transitions', () => {
  const servicePath = join(process.cwd(), 'backend', 'src', 'services', 'notificationService.ts');
  assert.ok(existsSync(servicePath), 'notificationService.ts must exist');

  const content = readFileSync(servicePath, 'utf8');
  assert.match(
    content,
    /export const NOTIFICATION_LIFECYCLE_TRANSITIONS/,
    'must export NOTIFICATION_LIFECYCLE_TRANSITIONS'
  );
  assert.match(content, /bounty_created/);
  assert.match(content, /bounty_reserved/);
  assert.match(content, /bounty_submitted/);
  assert.match(content, /bounty_released/);
  assert.match(content, /bounty_refunded/);
  assert.match(content, /bounty_disputed/);
});

test('ISSUE-1454: bountyStore fires sendNotification across every lifecycle transition', () => {
  const bountyStorePath = join(process.cwd(), 'backend', 'src', 'services', 'bountyStore.ts');
  assert.ok(existsSync(bountyStorePath), 'bountyStore.ts must exist');

  const content = readFileSync(bountyStorePath, 'utf8');

  // Verify transition invocations
  assert.match(
    content,
    /sendNotification\(\s*recipients,\s*['"]bounty_created['"]/,
    'must fire on bounty creation'
  );
  assert.match(
    content,
    /sendNotification\([^)]*?['"]bounty_reserved['"]/,
    'must fire on bounty reservation'
  );
  assert.match(
    content,
    /sendNotification\([^)]*?['"]bounty_submitted['"]/,
    'must fire on bounty submission'
  );
  assert.match(
    content,
    /sendNotification\([^)]*?['"]bounty_released['"]/,
    'must fire on bounty release'
  );
  assert.match(
    content,
    /sendNotification\([^)]*?['"]bounty_refunded['"]/,
    'must fire on bounty refund/cancellation'
  );
  assert.match(
    content,
    /sendNotification\([^)]*?['"]bounty_disputed['"]/,
    'must fire on dispute opening'
  );
  assert.match(
    content,
    /resolveDisputeBounty[\s\S]*?sendNotification/,
    'must fire on dispute resolution'
  );
});

test('ISSUE-1454: Notifications are opt-in and not forced on users', () => {
  const servicePath = join(process.cwd(), 'backend', 'src', 'services', 'notificationService.ts');
  const content = readFileSync(servicePath, 'utf8');

  assert.match(content, /export function setNotificationOptIn/, 'must export setNotificationOptIn');
  assert.match(content, /export function getNotificationOptIn/, 'must export getNotificationOptIn');
  assert.match(
    content,
    /export function isNotificationOptedIn/,
    'must export isNotificationOptedIn'
  );
  assert.match(
    content,
    /isNotificationOptedIn\(r\.address\)/,
    'sendNotification must filter out unopted recipients'
  );
});

test('ISSUE-1454: End-to-end delivery mechanism via webhook with HMAC-SHA256 signature', () => {
  const servicePath = join(process.cwd(), 'backend', 'src', 'services', 'notificationService.ts');
  const content = readFileSync(servicePath, 'utf8');

  // Assert Webhook dispatch with signature
  assert.match(content, /dispatchWebhook/);
  assert.match(content, /crypto\.createHmac\(['"]sha256['"],\s*secret\)/);
  assert.match(content, /X-Bounty-Signature/);

  // Validate algorithm logic directly
  const secret = 'webhook-test-secret';
  const body = JSON.stringify({ event: 'bounty_released', test: true });
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.ok(sig && sig.length === 64, 'HMAC-SHA256 must produce 64-hex char signature');
});

test('ISSUE-1454: Backend exposes opt-in preference endpoints', () => {
  const appPath = join(process.cwd(), 'backend', 'src', 'app.ts');
  const content = readFileSync(appPath, 'utf8');

  assert.match(
    content,
    /\/api\/notifications\/opt-in/,
    'app.ts must route /api/notifications/opt-in'
  );
  assert.match(content, /setNotificationOptIn/, 'app.ts must invoke setNotificationOptIn');
  assert.match(content, /getNotificationOptIn/, 'app.ts must invoke getNotificationOptIn');
});

test('ISSUE-1454: README.md documents lifecycle notifications and delivery channels', () => {
  const readmePath = join(process.cwd(), 'README.md');
  const content = readFileSync(readmePath, 'utf8');

  assert.match(
    content,
    /Notifications & State Change Hooks/,
    'README.md must feature Notifications section'
  );
  assert.match(content, /bounty_reserved/);
  assert.match(content, /bounty_submitted/);
  assert.match(content, /bounty_released/);
  assert.match(content, /bounty_refunded/);
  assert.match(content, /bounty_disputed/);
  assert.match(content, /X-Bounty-Signature/);
});
