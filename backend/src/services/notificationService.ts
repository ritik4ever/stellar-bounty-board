import crypto from 'node:crypto';
import { logger } from '../logger';

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

function buildEmailBody(
  event: string,
  recipient: NotificationRecipient,
  payload: Record<string, unknown>
): { subject: string; text: string } {
  const bountyId = String(payload.bountyId ?? '');
  const title = String(payload.title ?? '');
  const amount = String(payload.amount ?? '');
  const token = String(payload.tokenSymbol ?? '');

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
        subject: `[Stellar Bounty Board] Notification: ${event}`,
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
      const toEmail = recipientPref?.email || recipient.address;

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
      });

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
    const response = await fetch(webhookUrl, { method: 'POST', headers, body });
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

/**
 * Dispatch notification for a bounty lifecycle transition to eligible recipients.
 * Opt-out is checked at call time and again per recipient immediately before the send.
 * Returns one outcome per recipient (sent / skipped / failed); skipped and failed
 * recipients are never retried here, so no recipient is alerted twice.
 */
export async function sendNotification(
  recipients: NotificationRecipient[],
  event: string,
  payload: Record<string, unknown>
): Promise<NotificationResult> {
  const channel = getChannel();
  if (!channel) return { event, channel: null, outcomes: [] };

  const candidates = recipients.filter((r) => isNotificationOptedIn(r.address));
  const outcomes = skipAll(
    recipients.filter((r) => !candidates.includes(r)),
    channel,
    'opted_out'
  );
  if (candidates.length === 0) return { event, channel, outcomes };

  const dispatched =
    channel === 'EMAIL'
      ? await dispatchEmail(candidates, event, payload)
      : await dispatchWebhook(candidates, event, payload);
  outcomes.push(...dispatched);

  const failed = outcomes.find((o) => o.status === 'failed');
  if (failed && failed.status === 'failed') {
    logger.error({ event, err: failed.error }, 'Notification dispatch failed');
  }
  return { event, channel, outcomes };
}
