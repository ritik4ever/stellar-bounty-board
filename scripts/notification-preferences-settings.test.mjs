import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #830: Add notification-preferences settings page
// Acceptance criteria:
// 1. A user can view and update their notification preferences through the new settings page
// 2. Saved preferences persist and are reflected on subsequent page loads
// 3. Toggles per channel and event type, save confirmation toast, in-flight disable

test('ISSUE-830: frontend/src/NotificationSettingsPage.tsx exists and defines settings page', () => {
  const pagePath = join(process.cwd(), 'frontend', 'src', 'NotificationSettingsPage.tsx');
  assert.ok(existsSync(pagePath), 'NotificationSettingsPage.tsx must exist');

  const content = readFileSync(pagePath, 'utf8');
  assert.match(
    content,
    /export default function NotificationSettingsPage/,
    'must export default NotificationSettingsPage'
  );
  assert.match(content, /Notification Preferences/, 'must render page title');
  assert.match(content, /getNotificationPreferences/, 'must call getNotificationPreferences');
  assert.match(content, /updateNotificationPreferences/, 'must call updateNotificationPreferences');
});

test('ISSUE-830: NotificationSettingsPage renders channel toggles and event lifecycle toggles', () => {
  const pagePath = join(process.cwd(), 'frontend', 'src', 'NotificationSettingsPage.tsx');
  const content = readFileSync(pagePath, 'utf8');

  // Channel toggles
  assert.match(
    content,
    /data-testid=["']channel-email-toggle["']/,
    'must have email channel toggle'
  );
  assert.match(
    content,
    /data-testid=["']channel-webhook-toggle["']/,
    'must have webhook channel toggle'
  );
  assert.match(
    content,
    /data-testid=["']channel-push-toggle["']/,
    'must have browser push channel toggle'
  );

  // Input fields for email and webhook URL
  assert.match(content, /data-testid=["']channel-email-input["']/, 'must have email input');
  assert.match(content, /data-testid=["']channel-webhook-input["']/, 'must have webhook URL input');

  // Event lifecycle types
  assert.match(content, /bounty_created/, 'must include bounty_created event');
  assert.match(content, /bounty_reserved/, 'must include bounty_reserved event');
  assert.match(content, /bounty_submitted/, 'must include bounty_submitted event');
  assert.match(content, /bounty_released/, 'must include bounty_released event');
  assert.match(content, /bounty_refunded/, 'must include bounty_refunded event');
  assert.match(content, /bounty_disputed/, 'must include bounty_disputed event');
});

test('ISSUE-830: Save confirmation toast, button disable during in-flight request, and persistence', () => {
  const pagePath = join(process.cwd(), 'frontend', 'src', 'NotificationSettingsPage.tsx');
  const content = readFileSync(pagePath, 'utf8');

  // Disabled during in-flight saving
  assert.match(
    content,
    /disabled=\{saving\}/,
    'save button must be disabled while a request is in flight'
  );
  assert.match(content, /Saving Preferences\.\.\./, 'must show in-flight progress state text');

  // Toast confirmation
  assert.match(
    content,
    /toast\.success\(['"]Notification preferences saved successfully!['"]\)/,
    'must show save confirmation toast'
  );

  // Local storage persistence
  assert.match(content, /localStorage\.setItem/, 'must persist saved preferences to localStorage');
  assert.match(content, /localStorage\.getItem/, 'must read saved preferences from localStorage');
});

test('ISSUE-830: Backend app.ts defines GET and PUT /api/notification-preferences endpoints', () => {
  const appPath = join(process.cwd(), 'backend', 'src', 'app.ts');
  const content = readFileSync(appPath, 'utf8');

  assert.match(
    content,
    /app\.get\(\s*['"]\/api\/notification-preferences\/:address['"]/,
    'backend must define GET /api/notification-preferences/:address'
  );
  assert.match(
    content,
    /app\.put\(\s*['"]\/api\/notification-preferences\/:address['"]/,
    'backend must define PUT /api/notification-preferences/:address'
  );
  assert.match(
    content,
    /app\.put\(\s*['"]\/api\/notification-preferences['"]/,
    'backend must define PUT /api/notification-preferences'
  );
});

test('ISSUE-830: frontend/src/api.ts and types.ts export preferences methods and types', () => {
  const apiPath = join(process.cwd(), 'frontend', 'src', 'api.ts');
  const apiContent = readFileSync(apiPath, 'utf8');

  assert.match(
    apiContent,
    /export async function getNotificationPreferences/,
    'api.ts must export getNotificationPreferences'
  );
  assert.match(
    apiContent,
    /export async function updateNotificationPreferences/,
    'api.ts must export updateNotificationPreferences'
  );

  const typesPath = join(process.cwd(), 'frontend', 'src', 'types.ts');
  const typesContent = readFileSync(typesPath, 'utf8');
  assert.match(
    typesContent,
    /export interface NotificationPreferences/,
    'types.ts must export NotificationPreferences'
  );
});

test('ISSUE-830: frontend/src/App.tsx routes to NotificationSettingsPage and includes header affordance', () => {
  const appPath = join(process.cwd(), 'frontend', 'src', 'App.tsx');
  const content = readFileSync(appPath, 'utf8');

  assert.match(
    content,
    /import NotificationSettingsPage from ['"]\.\/NotificationSettingsPage['"]/,
    'App.tsx must import NotificationSettingsPage'
  );
  assert.match(
    content,
    /pathname === ['"]\/settings\/notifications['"]/,
    'App.tsx must route to /settings/notifications'
  );
  assert.match(
    content,
    /data-testid=["']header-notification-preferences-btn["']/,
    'App.tsx must render header navigation button'
  );
});
