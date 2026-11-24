import crypto from 'node:crypto';
import { logger as defaultLogger } from '../logger';

export const NOTIFICATION_DELIVERY_EVENT = 'notification_delivery';

export const NOTIFICATION_DELIVERY_OUTCOMES = {
  pending: 'pending',
  committed: 'committed',
  failed: 'failed',
} as const;

export type NotificationDeliveryOutcome =
  (typeof NOTIFICATION_DELIVERY_OUTCOMES)[keyof typeof NOTIFICATION_DELIVERY_OUTCOMES];

export type NotificationChannel = 'EMAIL' | 'WEBHOOK';

/**
 * Deterministically hash an identifier/token into a truncated SHA-256 digest
 * so log aggregators can correlate delivery attempts, retries, and transitions
 * without leaking raw paging tokens, webhook secrets, API keys, or user addresses.
 */
export function redactNotificationReference(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (/^sha256:[0-9a-f]{16}$/.test(trimmed)) {
    return trimmed;
  }
  const digest = crypto.createHash('sha256').update(trimmed).digest('hex');
  return `sha256:${digest.slice(0, 16)}`;
}

/**
 * Recursively scrubs known sensitive patterns (Stellar secret keys, SendGrid API keys,
 * Bearer tokens, email addresses, webhook signatures) from loggable strings.
 */
export function scrubSensitiveData(text: string): string {
  return text
    .replace(/S[0-9A-Z]{55}/g, '[redacted-secret-key]')
    .replace(/SG\.[A-Za-z0-9_-]+/g, '[redacted-sendgrid-key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted-token]')
    .replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '[redacted-email]')
    .replace(/sha256=[0-9a-fA-F]{64}/g, 'sha256=[redacted-signature]');
}

export interface NotificationDeliveryTraceRecord {
  event: typeof NOTIFICATION_DELIVERY_EVENT;
  outcome: NotificationDeliveryOutcome;
  at: string;
  channel: NotificationChannel;
  lifecycleEvent: string;
  bountyId: string | null;
  eventRef: string | null;
  deliveryRef: string | null;
  cursorRef: string | null;
  recipientCount?: number;
  recipientRef?: string | null;
  statusCode?: number | null;
  reason?: string | null;
  error?: string | null;
}

export interface BuildTraceInput {
  outcome: string;
  channel?: NotificationChannel | string;
  lifecycleEvent?: string;
  bountyId?: string | number | null;
  eventRef?: string | null;
  eventId?: string | null;
  deliveryRef?: string | null;
  deliveryId?: string | null;
  cursorRef?: string | null;
  cursor?: string | null;
  recipientRef?: string | null;
  recipient?: string | null;
  recipientCount?: number;
  statusCode?: number | null;
  reason?: string | null;
  error?: string | null;
  at?: string;
}

export function buildNotificationDeliveryTrace(
  input: BuildTraceInput
): NotificationDeliveryTraceRecord {
  const allowedOutcomes = Object.values(NOTIFICATION_DELIVERY_OUTCOMES);
  if (!allowedOutcomes.includes(input.outcome as NotificationDeliveryOutcome)) {
    throw new Error(
      `unknown notification delivery trace outcome: ${input.outcome}; must be one of ${allowedOutcomes.join(', ')}`
    );
  }

  const channel = (
    input.channel ? String(input.channel).toUpperCase() : 'WEBHOOK'
  ) as NotificationChannel;

  const bountyId =
    input.bountyId != null && input.bountyId !== '' ? String(input.bountyId) : null;

  return {
    event: NOTIFICATION_DELIVERY_EVENT,
    outcome: input.outcome as NotificationDeliveryOutcome,
    at: input.at ?? new Date().toISOString(),
    channel,
    lifecycleEvent: input.lifecycleEvent ? String(input.lifecycleEvent) : 'unknown',
    bountyId,
    eventRef: redactNotificationReference(input.eventRef ?? input.eventId),
    deliveryRef: redactNotificationReference(input.deliveryRef ?? input.deliveryId),
    cursorRef: redactNotificationReference(input.cursorRef ?? input.cursor),
    recipientCount:
      typeof input.recipientCount === 'number' && Number.isFinite(input.recipientCount)
        ? input.recipientCount
        : undefined,
    recipientRef: redactNotificationReference(input.recipientRef ?? input.recipient),
    statusCode:
      typeof input.statusCode === 'number' && Number.isFinite(input.statusCode)
        ? input.statusCode
        : null,
    reason: typeof input.reason === 'string' ? input.reason : null,
    error: typeof input.error === 'string' ? scrubSensitiveData(input.error) : null,
  };
}

export type NotificationDeliveryTraceSink = (
  record: NotificationDeliveryTraceRecord
) => void;

export interface NotificationDeliveryTrace {
  pending(entry: Omit<BuildTraceInput, 'outcome'>): NotificationDeliveryTraceRecord;
  committed(entry: Omit<BuildTraceInput, 'outcome'>): NotificationDeliveryTraceRecord;
  failed(entry: Omit<BuildTraceInput, 'outcome'>): NotificationDeliveryTraceRecord;
}

export function createNotificationDeliveryTrace(
  sink: NotificationDeliveryTraceSink
): NotificationDeliveryTrace {
  if (typeof sink !== 'function') {
    throw new TypeError('notification delivery trace sink must be a function');
  }

  const emit =
    (outcome: NotificationDeliveryOutcome) =>
    (entry: Omit<BuildTraceInput, 'outcome'>): NotificationDeliveryTraceRecord => {
      const record = buildNotificationDeliveryTrace({ ...entry, outcome });
      sink(record);
      return record;
    };

  return {
    pending: emit(NOTIFICATION_DELIVERY_OUTCOMES.pending),
    committed: emit(NOTIFICATION_DELIVERY_OUTCOMES.committed),
    failed: emit(NOTIFICATION_DELIVERY_OUTCOMES.failed),
  };
}

export function createConsoleNotificationDeliveryTrace(
  logger: Pick<Console, 'log'> = console
): NotificationDeliveryTrace {
  return createNotificationDeliveryTrace((record) => {
    logger.log(`[NotificationWorker][delivery-trace] ${JSON.stringify(record)}`);
  });
}

let activeGlobalTraceSink: NotificationDeliveryTraceSink | null = null;

export function setGlobalNotificationDeliveryTraceSink(
  sink: NotificationDeliveryTraceSink | null
): void {
  activeGlobalTraceSink = sink;
}

export function getGlobalNotificationDeliveryTrace(): NotificationDeliveryTrace {
  if (activeGlobalTraceSink) {
    return createNotificationDeliveryTrace(activeGlobalTraceSink);
  }
  return createNotificationDeliveryTrace((record) => {
    const jsonStr = JSON.stringify(record);
    if (record.outcome === 'committed') {
      defaultLogger.info({ deliveryTrace: record }, `[NotificationWorker][delivery-trace] ${jsonStr}`);
    } else if (record.outcome === 'failed') {
      defaultLogger.warn({ deliveryTrace: record }, `[NotificationWorker][delivery-trace] ${jsonStr}`);
    } else {
      defaultLogger.info({ deliveryTrace: record }, `[NotificationWorker][delivery-trace] ${jsonStr}`);
    }
  });
}
