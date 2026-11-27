import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger, logStructured } from '../logger';
import {
  notificationJournalEntrySchema,
  sendNotificationInputSchema,
  webhookUrlSchema,
} from '../validation/notification';

export interface NotificationRecipient {
  role: string;
  address: string;
}

export type NotificationChannel = 'EMAIL' | 'WEBHOOK';

/**
 * Standard bounty lifecycle transitions that trigger notification hooks.
 */
export const NOTIFICATION_LIFECYCLE_TRANSITIONS = [
  'bounty_created',
  'bounty_reserved',
  'bounty_submitted',
  'bounty_released',
  'bounty_refunded',
  'bounty_disputed',
] as const;

export interface NotificationOptInPreference {
  address: string;
  optIn: boolean;
  email?: string;
  webhookUrl?: string;
  updatedAt?: number;
}

const userOptInPreferences = new Map<string, NotificationOptInPreference>();

/**
 * Opt a user in or out of bounty lifecycle notifications.
 */
export function setNotificationOptIn(
  address: string,
  optIn: boolean,
  options?: { email?: string; webhookUrl?: string }
): NotificationOptInPreference {
  const pref: NotificationOptInPreference = {
    address,
    optIn,
    email: options?.email,
    webhookUrl: options?.webhookUrl,
    updatedAt: Date.now(),
  };
  userOptInPreferences.set(address, pref);
  return pref;
}

/**
 * Get notification opt-in preference for a given address.
 */
export function getNotificationOptIn(address: string): NotificationOptInPreference | null {
  return userOptInPreferences.get(address) ?? null;
}

/**
 * Clear in-memory notification preferences (primarily for test isolation).
 */
export function clearNotificationOptIns(): void {
  userOptInPreferences.clear();
}

/**
 * Check whether a given user address has opted in to notifications.
 * Respects strict opt-in mode when NOTIFICATION_OPT_IN_STRICT is set.
 */
export function isNotificationOptedIn(address: string): boolean {
  const pref = userOptInPreferences.get(address);
  if (pref !== undefined) {
    return pref.optIn;
  }
  if (process.env.NOTIFICATION_OPT_IN_STRICT === 'true') {
    return false;
  }
  return true;
}

function getChannel(): NotificationChannel | null {
  const ch = process.env.NOTIFICATION_CHANNEL?.trim().toUpperCase();
  if (ch === 'EMAIL' || ch === 'WEBHOOK') return ch;
  return null;
}

// ── Delivery-worker hardening helpers (#1947) ────────────────────────────────

const DEFAULT_NOTIFICATION_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;

/**
 * Resolves the outbound HTTP timeout for both SendGrid and webhook calls.
 * Bounded so that a misconfigured env value cannot disable the timeout or
 * hold the worker open indefinitely.
 */
function getNotificationTimeoutMs(): number {
  const raw = process.env.NOTIFICATION_TIMEOUT_MS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_TIMEOUT_MS) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_NOTIFICATION_TIMEOUT_MS;
}

/**
 * Strips control characters and bounds length for values that end up in an
 * outbound email header (notably `Subject`). Prevents CRLF header injection
 * from untrusted payload fields such as a bounty title.
 */
function sanitizeHeaderValue(value: string, maxLen = 200): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function buildEmailBody(
  event: string,
  recipient: NotificationRecipient,
  payload: Record<string, unknown>
): { subject: string; text: string } {
  const bountyId = String(payload.bountyId ?? '');
  const title = sanitizeHeaderValue(String(payload.title ?? ''));
  const amount = String(payload.amount ?? '');
  const token = String(payload.tokenSymbol ?? '');
  const safeEvent = sanitizeHeaderValue(event, 64);

  switch (event) {
    case 'bounty_created':
      return {
        subject: `[Stellar Bounty Board] New bounty created: ${title}`,
        text: `A new bounty (${bountyId}) has been created.\n\nTitle: ${title}\nReward: ${amount} ${token}\n\nLog in to manage it.`,
      };
    case 'bounty_reserved':
      return {
        subject: `[Stellar Bounty Board] Bounty ${bountyId} has been reserved`,
        text: `A contributor has reserved bounty ${bountyId}: "${title}".\n\nReward: ${amount} ${token}\n\nLog in to track their progress.`,
      };
    case 'bounty_submitted':
      return {
        subject: `[Stellar Bounty Board] Solution submitted for bounty ${bountyId}`,
        text: `A solution has been submitted for bounty ${bountyId}: "${title}".\n\nSubmission URL: ${String(payload.submissionUrl ?? 'N/A')}\n\nLog in to review and release or refund the reward.`,
      };
    case 'bounty_released':
      return {
        subject: `[Stellar Bounty Board] Bounty ${bountyId} reward released`,
        text: `Congratulations! Your submission for bounty ${bountyId}: "${title}" has been approved and your reward of ${amount} ${token} has been released.`,
      };
    case 'bounty_refunded':
      return {
        subject: `[Stellar Bounty Board] Bounty ${bountyId} has been refunded`,
        text: `The bounty ${bountyId}: "${title}" has been refunded. The reward of ${amount} ${token} has been returned to the maintainer.`,
      };
    case 'bounty_disputed':
      return {
        subject: `[Stellar Bounty Board] Dispute raised for bounty ${bountyId}`,
        text: `A dispute has been raised for bounty ${bountyId}.\n\nReason: ${String(payload.reason ?? 'N/A')}\n\nLog in to review the dispute.`,
      };
    case 'dispute_stuck_alert':
      return {
        subject: `[Stellar Bounty Board] ACTION REQUIRED: Stuck disputed bounty ${bountyId}`,
        text: `The following bounty has been in "disputed" status for ${String(payload.hoursDisputed ?? '?')} hours, exceeding the resolution SLA.\n\nBounty: ${bountyId}\nTitle: ${title}\nRepository: ${String(payload.repo ?? 'N/A')}\nContributor: ${String(payload.contributor ?? 'N/A')}\nMaintainer: ${String(payload.maintainer ?? 'N/A')}\nDisputed at: ${String(payload.disputedAt ?? 'N/A')}\n\nPlease review and resolve this dispute promptly.`,
      };
    default:
      return {
        subject: `[Stellar Bounty Board] Notification: ${safeEvent}`,
        text: `A bounty event (${event}) occurred for bounty ${bountyId}.\n\nDetails:\n${JSON.stringify(payload, null, 2)}`,
      };
  }
}

export type NotificationOutcome =
  | { address: string; channel: NotificationChannel; status: 'sent' }
  | {
      address: string;
      channel: NotificationChannel;
      status: 'skipped';
      reason: 'opted_out' | 'not_configured';
    }
  | { address: string; channel: NotificationChannel; status: 'failed'; error: string };

export interface NotificationResult {
  event: string;
  channel: NotificationChannel | null;
  outcomes: NotificationOutcome[];
}

function skipAll(
  recipients: NotificationRecipient[],
  channel: NotificationChannel,
  reason: 'opted_out' | 'not_configured'
): NotificationOutcome[] {
  return recipients.map(
    (r): NotificationOutcome => ({ address: r.address, channel, status: 'skipped', reason })
  );
}

async function dispatchEmail(
  recipients: NotificationRecipient[],
  event: string,
  payload: Record<string, unknown>
): Promise<NotificationOutcome[]> {
  const channel: NotificationChannel = 'EMAIL';
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const fromEmail = process.env.SENDGRID_FROM_EMAIL?.trim() ?? 'noreply@stellarbountyboard.io';

  if (!apiKey) {
    logger.warn({ event }, 'SENDGRID_API_KEY not set; skipping email notification');
    return skipAll(recipients, channel, 'not_configured');
  }

  const outcomes: NotificationOutcome[] = [];
  for (const recipient of recipients) {
    // Re-check at the send boundary: the user may have opted out after enqueue.
    if (!isNotificationOptedIn(recipient.address)) {
      outcomes.push(...skipAll([recipient], channel, 'opted_out'));
      continue;
    }
    try {
      const { subject, text } = buildEmailBody(event, recipient, payload);
      const recipientPref = userOptInPreferences.get(recipient.address);
      const toEmail = sanitizeHeaderValue(recipientPref?.email || recipient.address, 254);

      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: toEmail }] }],
          from: { email: fromEmail },
          subject,
          content: [{ type: 'text/plain', value: text }],
        }),
        signal: AbortSignal.timeout(getNotificationTimeoutMs()),
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after') ?? 'unset';
        const body = await response.text();
        throw new Error(
          `SendGrid responded 429 (rate limited, retry-after=${retryAfter}): ${body}`,
        );
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`SendGrid responded ${response.status}: ${body}`);
      }
      outcomes.push({ address: recipient.address, channel, status: 'sent' });
    } catch (err) {
      outcomes.push({
        address: recipient.address,
        channel,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

async function dispatchWebhook(
  recipients: NotificationRecipient[],
  event: string,
  payload: Record<string, unknown>
): Promise<NotificationOutcome[]> {
  const channel: NotificationChannel = 'WEBHOOK';
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    logger.warn({ event }, 'NOTIFICATION_WEBHOOK_URL not set; skipping webhook notification');
    return skipAll(recipients, channel, 'not_configured');
  }

  // Fail closed on misconfigured or downgraded webhook URLs (#1947).
  const urlCheck = webhookUrlSchema.safeParse(webhookUrl);
  if (!urlCheck.success) {
    logger.warn(
      { event, reason: urlCheck.error.issues[0]?.message },
      'Invalid NOTIFICATION_WEBHOOK_URL; skipping webhook notification',
    );
    return skipAll(recipients, channel, 'not_configured');
  }

  // Re-check at the send boundary, immediately before the request is built.
  const eligible = recipients.filter((r) => isNotificationOptedIn(r.address));
  const optedOut = recipients.filter((r) => !eligible.includes(r));
  const outcomes = skipAll(optedOut, channel, 'opted_out');
  if (eligible.length === 0) return outcomes;

  const body = JSON.stringify({ event, payload, recipients: eligible, timestamp: Date.now() });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const secret = process.env.NOTIFICATION_WEBHOOK_SECRET?.trim();
  if (secret) {
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    headers['X-Bounty-Signature'] = `sha256=${sig}`;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(getNotificationTimeoutMs()),
    });
    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Webhook responded ${response.status}: ${responseBody}`);
    }
    outcomes.push(...eligible.map((r): NotificationOutcome => ({ address: r.address, channel, status: 'sent' })));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    outcomes.push(...eligible.map((r): NotificationOutcome => ({ address: r.address, channel, status: 'failed', error })));
  }
  return outcomes;
}

export type NotificationDeliveryStatus = 'in_progress' | 'pending' | 'completed';

export interface NotificationDeliveryEntry {
  deliveryId: string;
  event: string;
  payload: Record<string, unknown>;
  recipients: NotificationRecipient[];
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  outcomes: NotificationOutcome[];
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface NotificationSendOptions {
  /** Optional correlation/delivery reference for resumption and deduplication. */
  deliveryRef?: string;
  /** Optional identifier of the worker executing the dispatch. */
  workerId?: string;
}

export interface NotificationResumeSummary {
  resumed: number;
  completed: number;
  failed: number;
  remaining: number;
}

const memoryJournal = new Map<string, NotificationDeliveryEntry>();

function getNotificationJournalPath(): string {
  if (process.env.NOTIFICATION_DELIVERY_STORE_PATH?.trim()) {
    return path.resolve(process.env.NOTIFICATION_DELIVERY_STORE_PATH.trim());
  }
  const storePath = process.env.BOUNTY_STORE_PATH?.trim();
  if (storePath) {
    return path.resolve(storePath.replace(/\.json$/i, '.notifications.json'));
  }
  return path.resolve(__dirname, '../../data/bounties.notifications.json');
}

function readJournal(): Map<string, NotificationDeliveryEntry> {
  if (process.env.NODE_ENV === 'test' && !process.env.NOTIFICATION_DELIVERY_STORE_PATH) {
    return new Map<string, NotificationDeliveryEntry>(memoryJournal);
  }
  const filePath = getNotificationJournalPath();
  const map = new Map<string, NotificationDeliveryEntry>(memoryJournal);
  if (!fs.existsSync(filePath)) return map;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return map;
    const parsed = JSON.parse(raw);
    for (const [k, v] of Object.entries(parsed)) {
      map.set(k, v as NotificationDeliveryEntry);
      memoryJournal.set(k, v as NotificationDeliveryEntry);
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read notification delivery journal; starting empty');
  }
  return map;
}

function writeJournal(entries: Map<string, NotificationDeliveryEntry>): void {
  for (const [k, v] of entries.entries()) {
    memoryJournal.set(k, v);
  }
  if (process.env.NODE_ENV === 'test' && !process.env.NOTIFICATION_DELIVERY_STORE_PATH) {
    return;
  }
  const filePath = getNotificationJournalPath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const data = Object.fromEntries(entries.entries());
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    logger.warn({ err }, 'Failed to persist notification delivery journal');
  }
}

/**
 * Clear all in-memory and on-disk notification delivery journal entries (for test isolation).
 */
export function clearNotificationDeliveryJournal(): void {
  memoryJournal.clear();
  const filePath = getNotificationJournalPath();
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    /* best effort */
  }
}

/**
 * Get all unfinished (pending or in_progress) notification deliveries.
 */
export function getPendingNotificationDeliveries(): NotificationDeliveryEntry[] {
  const journal = readJournal();
  return Array.from(journal.values()).filter(
    (entry) => entry.status === 'pending' || entry.status === 'in_progress'
  );
}

/**
 * Retrieve a single notification delivery entry by deliveryId.
 */
export function getNotificationDelivery(deliveryId: string): NotificationDeliveryEntry | null {
  const journal = readJournal();
  return journal.get(deliveryId) ?? null;
}

/**
 * Dispatch notification for a bounty lifecycle transition to eligible recipients (#1946).
 *
 * Supports worker interruption recovery, SendGrid 429 rate limit backoff, webhook
 * timeout retries, and process restart resumption via a persistent delivery journal:
 * - Already sent recipients in an interrupted batch are never re-alerted (no duplicate alerts).
 * - Recipients who opted out between an initial attempt and replay are skipped at the send boundary.
 * - Remaining recipients are safely retried upon worker resumption.
 *
 * All caller-supplied input is validated at the worker trust boundary (#1947) before
 * any outbound call, journal write, or preference lookup. Malformed input is rejected
 * with per-recipient `failed` outcomes and never dispatched.
 */
export async function sendNotification(
  recipients: NotificationRecipient[],
  event: string,
  payload: Record<string, unknown>,
  options?: NotificationSendOptions
): Promise<NotificationResult> {
  const channel = getChannel();
  if (!channel) return { event, channel: null, outcomes: [] };

  // Worker trust boundary (#1947): reject malformed input before any dispatch.
  const validation = sendNotificationInputSchema.safeParse({
    recipients,
    event,
    payload,
    options,
  });
  if (!validation.success) {
    const safeEvent = typeof event === 'string' ? sanitizeHeaderValue(event, 64) : '<invalid>';
    const safeRecipients: NotificationRecipient[] = Array.isArray(recipients) ? recipients : [];
    const failedOutcomes: NotificationOutcome[] = safeRecipients.length > 0
      ? safeRecipients.map((r): NotificationOutcome => ({
          address: typeof r?.address === 'string' ? r.address : '<invalid>',
          channel,
          status: 'failed',
          error: 'invalid_input',
        }))
      : [{ address: '<invalid>', channel, status: 'failed', error: 'invalid_input' }];

    logStructured('warn', 'notification_input_rejected', {
      event: safeEvent,
      issues: validation.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return { event: safeEvent, channel, outcomes: failedOutcomes };
  }

  const validRecipients = validation.data.recipients;
  const validEvent = validation.data.event;
  const validPayload = validation.data.payload;
  const deliveryId = validation.data.options?.deliveryRef;

  const journal = deliveryId ? readJournal() : null;
  const existing = deliveryId && journal ? journal.get(deliveryId) : null;

  // If this delivery already fully completed, return previous outcomes without sending duplicate alerts
  if (existing?.status === 'completed') {
    return { event: validEvent, channel, outcomes: existing.outcomes };
  }

  // Preserve previously successful outcomes from an interrupted batch
  const previouslySent = new Map<string, NotificationOutcome>();
  if (existing?.outcomes) {
    for (const out of existing.outcomes) {
      if (out.status === 'sent') {
        previouslySent.set(out.address, out);
      }
    }
  }

  // Separate recipients that already received the alert from remaining recipients
  const remainingRecipients = validRecipients.filter((r) => !previouslySent.has(r.address));
  const outcomes: NotificationOutcome[] = [];

  // Add previously completed outcomes
  for (const r of validRecipients) {
    const prev = previouslySent.get(r.address);
    if (prev) {
      outcomes.push(prev);
    }
  }

  // Re-check opt-in at the send boundary for remaining recipients
  const candidates = remainingRecipients.filter((r) => isNotificationOptedIn(r.address));
  const newlyOptedOut = remainingRecipients.filter((r) => !candidates.includes(r));
  outcomes.push(...skipAll(newlyOptedOut, channel, 'opted_out'));

  // Dispatch only to remaining eligible candidates
  if (candidates.length > 0) {
    const dispatched =
      channel === 'EMAIL'
        ? await dispatchEmail(candidates, validEvent, validPayload)
        : await dispatchWebhook(candidates, validEvent, validPayload);
    outcomes.push(...dispatched);
  }

  if (deliveryId && journal) {
    const anyFailed = outcomes.some((o) => o.status === 'failed');
    const attempts = (existing?.attempts ?? 0) + 1;
    const status: NotificationDeliveryStatus = anyFailed ? 'pending' : 'completed';
    const failedOutcome = outcomes.find((o) => o.status === 'failed');

    const entry: NotificationDeliveryEntry = {
      deliveryId,
      event: validEvent,
      payload: validPayload,
      recipients: validRecipients,
      channel,
      status,
      outcomes,
      attempts,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      lastError: failedOutcome?.status === 'failed' ? failedOutcome.error : undefined,
    };

    journal.set(deliveryId, entry);
    writeJournal(journal);
  }

  const failed = outcomes.find((o) => o.status === 'failed');
  if (failed && failed.status === 'failed') {
    logger.error(
      { event: validEvent, deliveryId, err: failed.error },
      'Notification dispatch failed; delivery left pending for worker retry'
    );
  }

  return { event: validEvent, channel, outcomes };
}

/**
 * Re-drives unfinished or interrupted notification deliveries from the persistent journal (#1946).
 *
 * Run at startup or on scheduled worker ticks so that notifications interrupted by SendGrid 429
 * rate limits, webhook timeouts, or process restarts are resumed without duplicating alerts for
 * recipients who already received them.
 *
 * Each replayed entry is re-validated against the journal schema (#1947) before dispatch, so a
 * tampered or corrupted journal cannot smuggle malformed recipients, events, or payloads through
 * the outbound path. Invalid entries are logged and skipped without being modified, leaving them
 * visible to operators.
 */
export async function resumePendingNotificationDeliveries(): Promise<NotificationResumeSummary> {
  const pending = getPendingNotificationDeliveries();
  let completed = 0;
  let failed = 0;

  for (const entry of pending) {
    const validated = notificationJournalEntrySchema.safeParse(entry);
    if (!validated.success) {
      failed++;
      logStructured('warn', 'notification_delivery_resume_rejected', {
        deliveryId:
          typeof entry?.deliveryId === 'string' ? sanitizeHeaderValue(entry.deliveryId, 128) : '<invalid>',
        issues: validated.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      continue;
    }

    logStructured('info', 'notification_delivery_resume_attempt', {
      deliveryId: entry.deliveryId,
      attempts: entry.attempts,
      event: entry.event,
    });

    try {
      const result = await sendNotification(
        entry.recipients,
        entry.event,
        entry.payload,
        { deliveryRef: entry.deliveryId }
      );
      const hasFailed = result.outcomes.some((o) => o.status === 'failed');
      if (!hasFailed) {
        completed++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      logStructured('warn', 'notification_delivery_resume_failed', {
        deliveryId: entry.deliveryId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const remaining = getPendingNotificationDeliveries().length;
  logStructured('info', 'notification_delivery_resume_complete', {
    resumed: pending.length,
    completed,
    failed,
    remaining,
  });

  return { resumed: pending.length, completed, failed, remaining };
}
