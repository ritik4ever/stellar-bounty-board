import fs from 'node:fs';
import path from 'node:path';

export type NotificationChannel = 'EMAIL' | 'WEBHOOK';

export type NotificationEventPreference = {
  essential?: boolean;
  marketing?: boolean;
  [eventType: string]: boolean | undefined;
};

export type NotificationPreferencesByChannel = Record<NotificationChannel, NotificationEventPreference>;

export type NotificationPreferencesMap = Record<string, Partial<NotificationPreferencesByChannel>>;

const DEFAULT_EVENT_TYPES = [
  'bounty_created',
  'bounty_reserved',
  'bounty_submitted',
  'bounty_released',
  'bounty_refunded',
  'bounty_disputed',
  'dispute_stuck_alert',
] as const;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesByChannel = {
  EMAIL: {
    essential: true,
    marketing: false,
    ...Object.fromEntries(DEFAULT_EVENT_TYPES.map((eventType) => [eventType, true])),
  },
  WEBHOOK: {
    essential: true,
    marketing: false,
    ...Object.fromEntries(DEFAULT_EVENT_TYPES.map((eventType) => [eventType, true])),
  },
};

function resolveStorePath(): string {
  const configuredPath = process.env.NOTIFICATION_PREFERENCES_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  return path.resolve(process.cwd(), 'data', 'notification-preferences.json');
}

function ensureStoreFile(): string {
  const storePath = resolveStorePath();
  const directory = path.dirname(storePath);
  fs.mkdirSync(directory, { recursive: true });

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, '{}', 'utf8');
  }

  return storePath;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAddress(address: string): string {
  return address.trim();
}

function clonePreferenceSet(value: NotificationEventPreference): NotificationEventPreference {
  return Object.fromEntries(Object.entries(value).map(([key, itemValue]) => [key, itemValue]));
}

function cloneDefaultPrefs(): NotificationPreferencesByChannel {
  return {
    EMAIL: clonePreferenceSet(DEFAULT_NOTIFICATION_PREFERENCES.EMAIL),
    WEBHOOK: clonePreferenceSet(DEFAULT_NOTIFICATION_PREFERENCES.WEBHOOK),
  };
}

function mergePreferenceSet(
  base: NotificationEventPreference,
  incoming: Record<string, unknown> | undefined,
): NotificationEventPreference {
  if (!isPlainObject(incoming)) {
    return { ...base };
  }

  const merged: NotificationEventPreference = { ...base };

  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === 'boolean') {
      merged[key] = value;
    }
  }

  return merged;
}

export function getNotificationPreferences(address: string): NotificationPreferencesByChannel {
  const normalizedAddress = normalizeAddress(address);
  const storePath = ensureStoreFile();
  const raw = fs.readFileSync(storePath, 'utf8').trim();

  if (!raw) {
    return cloneDefaultPrefs();
  }

  try {
    const parsed = JSON.parse(raw) as NotificationPreferencesMap;
    const userPrefs = parsed[normalizedAddress];

    if (!isPlainObject(userPrefs)) {
      return cloneDefaultPrefs();
    }

    return {
      EMAIL: mergePreferenceSet(
        DEFAULT_NOTIFICATION_PREFERENCES.EMAIL,
        isPlainObject(userPrefs.EMAIL) ? userPrefs.EMAIL : undefined,
      ),
      WEBHOOK: mergePreferenceSet(
        DEFAULT_NOTIFICATION_PREFERENCES.WEBHOOK,
        isPlainObject(userPrefs.WEBHOOK) ? userPrefs.WEBHOOK : undefined,
      ),
    };
  } catch {
    fs.writeFileSync(storePath, '{}', 'utf8');
    return cloneDefaultPrefs();
  }
}

export function setNotificationPreferences(
  address: string,
  updates: Partial<NotificationPreferencesByChannel>,
): NotificationPreferencesByChannel {
  const normalizedAddress = normalizeAddress(address);
  const storePath = ensureStoreFile();
  const raw = fs.readFileSync(storePath, 'utf8').trim();
  const parsed: NotificationPreferencesMap = raw ? JSON.parse(raw) : {};

  const nextPreferences: NotificationPreferencesByChannel = getNotificationPreferences(normalizedAddress);

  if (isPlainObject(updates.EMAIL)) {
    nextPreferences.EMAIL = mergePreferenceSet(nextPreferences.EMAIL, updates.EMAIL);
  }

  if (isPlainObject(updates.WEBHOOK)) {
    nextPreferences.WEBHOOK = mergePreferenceSet(nextPreferences.WEBHOOK, updates.WEBHOOK);
  }

  parsed[normalizedAddress] = nextPreferences;
  fs.writeFileSync(storePath, JSON.stringify(parsed, null, 2), 'utf8');

  return nextPreferences;
}

export function getChannelPreference(
  address: string,
  channel: NotificationChannel,
  eventType: string,
): boolean {
  const preferences = getNotificationPreferences(address);
  const channelPrefs = preferences[channel];

  if (typeof channelPrefs[eventType] === 'boolean') {
    return channelPrefs[eventType] as boolean;
  }

  if (typeof channelPrefs.essential === 'boolean') {
    return channelPrefs.essential;
  }

  return true;
}

export function normalizeNotificationPreferencesInput(
  input: unknown,
): Partial<NotificationPreferencesByChannel> {
  if (!isPlainObject(input)) {
    throw new Error('Notification preferences body must be an object.');
  }

  const result: Partial<NotificationPreferencesByChannel> = {};

  for (const channel of ['EMAIL', 'WEBHOOK'] as const) {
    const value = input[channel];
    if (value === undefined) {
      continue;
    }

    if (!isPlainObject(value)) {
      throw new Error(`Notification preferences for ${channel} must be an object.`);
    }

    const normalized: Record<string, boolean> = {};
    for (const [key, itemValue] of Object.entries(value)) {
      if (typeof itemValue !== 'boolean') {
        throw new Error(`Notification preference ${channel}.${key} must be a boolean.`);
      }
      normalized[key] = itemValue;
    }

    result[channel] = normalized as NotificationEventPreference;
  }

  return result;
}
