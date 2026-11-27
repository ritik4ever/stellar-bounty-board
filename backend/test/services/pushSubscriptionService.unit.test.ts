import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  registerPushSubscription,
  unregisterPushSubscription,
  listPushSubscriptions,
  resolvePushStorePath,
} from '../../src/services/pushSubscriptionService';

describe('services/pushSubscriptionService unit tests', () => {
  let tmpDir: string;
  let tmpStorePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-service-test-'));
    tmpStorePath = path.join(tmpDir, 'push-subscriptions.json');
    process.env.PUSH_SUBSCRIPTION_STORE_PATH = tmpStorePath;
  });

  afterEach(() => {
    delete process.env.PUSH_SUBSCRIPTION_STORE_PATH;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves default and environment-configured store paths', () => {
    expect(resolvePushStorePath()).toBe(tmpStorePath);
    delete process.env.PUSH_SUBSCRIPTION_STORE_PATH;
    expect(resolvePushStorePath()).toContain('push-subscriptions.json');
  });

  it('lists empty array when store does not exist', () => {
    expect(listPushSubscriptions(tmpStorePath)).toEqual([]);
  });

  it('registers a new push subscription successfully', () => {
    const sub = {
      endpoint: 'https://push.example.com/sub/1',
      keys: { p256dh: 'p256-key-1', auth: 'auth-key-1' },
      createdAt: 1700000000000,
    };

    const registered = registerPushSubscription(sub, tmpStorePath);
    expect(registered).toEqual(sub);

    const list = listPushSubscriptions(tmpStorePath);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(sub);
  });

  it('updates keys for existing subscription idempotently without creating duplicates', () => {
    const sub1 = {
      endpoint: 'https://push.example.com/sub/1',
      keys: { p256dh: 'p256-key-1', auth: 'auth-key-1' },
      createdAt: 1700000000000,
    };
    registerPushSubscription(sub1, tmpStorePath);

    const sub1Updated = {
      endpoint: 'https://push.example.com/sub/1',
      keys: { p256dh: 'new-key', auth: 'new-auth' },
      createdAt: 1700000005000,
    };
    const result = registerPushSubscription(sub1Updated, tmpStorePath);
    expect(result.keys).toEqual({ p256dh: 'new-key', auth: 'new-auth' });

    const list = listPushSubscriptions(tmpStorePath);
    expect(list).toHaveLength(1);
    expect(list[0].keys).toEqual({ p256dh: 'new-key', auth: 'new-auth' });
  });

  it('unregisters an existing subscription and returns true', () => {
    registerPushSubscription(
      {
        endpoint: 'https://push.example.com/sub/1',
        keys: { p256dh: 'key1', auth: 'auth1' },
        createdAt: 1700000000000,
      },
      tmpStorePath,
    );
    registerPushSubscription(
      {
        endpoint: 'https://push.example.com/sub/2',
        keys: { p256dh: 'key2', auth: 'auth2' },
        createdAt: 1700000000000,
      },
      tmpStorePath,
    );

    const removed = unregisterPushSubscription('https://push.example.com/sub/1', tmpStorePath);
    expect(removed).toBe(true);

    const remaining = listPushSubscriptions(tmpStorePath);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].endpoint).toBe('https://push.example.com/sub/2');
  });

  it('returns false when unregistering a non-existent subscription', () => {
    const removed = unregisterPushSubscription('https://push.example.com/not-found', tmpStorePath);
    expect(removed).toBe(false);
  });

  it('handles corrupted JSON store gracefully', () => {
    fs.mkdirSync(path.dirname(tmpStorePath), { recursive: true });
    fs.writeFileSync(tmpStorePath, 'corrupted invalid json {{{', 'utf8');

    expect(listPushSubscriptions(tmpStorePath)).toEqual([]);
  });
});
