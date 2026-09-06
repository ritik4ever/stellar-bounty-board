/**
 * pushSubscriptionService.ts – JSON-backed persistence for browser push
 * notification subscriptions.
 *
 * Subscriptions are keyed by their endpoint URL so that re-subscribing with
 * the same endpoint is idempotent. The store is a simple JSON file mirroring
 * the pattern used by store.ts for bounties.
 */

import fs from "fs";
import path from "path";

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  createdAt: number;
}

export function resolvePushStorePath(): string {
  return (
    process.env.PUSH_SUBSCRIPTION_STORE_PATH ??
    path.join(__dirname, "../data/push-subscriptions.json")
  );
}

function tryParse<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadSubscriptions(storePath?: string): PushSubscription[] {
  const store = storePath ?? resolvePushStorePath();
  const primary = tryParse<PushSubscription[]>(store);
  if (primary !== null) return primary;
  return [];
}

function saveSubscriptions(subscriptions: PushSubscription[], storePath?: string): void {
  const store = storePath ?? resolvePushStorePath();
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.writeFileSync(store, JSON.stringify(subscriptions, null, 2), "utf8");
}

/**
 * Register (or update) a push subscription. Returns the stored subscription.
 */
export function registerPushSubscription(
  subscription: PushSubscription,
  storePath?: string,
): PushSubscription {
  const subscriptions = loadSubscriptions(storePath);
  const existing = subscriptions.find((s) => s.endpoint === subscription.endpoint);

  if (existing) {
    existing.keys = subscription.keys;
    return existing;
  }

  const stored: PushSubscription = {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    createdAt: subscription.createdAt ?? Date.now(),
  };
  subscriptions.push(stored);
  saveSubscriptions(subscriptions, storePath);
  return stored;
}

/**
 * Remove a push subscription by endpoint. Returns true if one was removed.
 */
export function unregisterPushSubscription(
  endpoint: string,
  storePath?: string,
): boolean {
  const subscriptions = loadSubscriptions(storePath);
  const next = subscriptions.filter((s) => s.endpoint !== endpoint);
  if (next.length === subscriptions.length) return false;
  saveSubscriptions(next, storePath);
  return true;
}

/**
 * List all registered push subscriptions.
 */
export function listPushSubscriptions(storePath?: string): PushSubscription[] {
  return loadSubscriptions(storePath);
}
