import crypto from "node:crypto";
import { logger } from "../logger";
import { addToDeadLetter } from "./deadLetterStore";
import { notificationsRetriedTotal, notificationsFailedTotal } from "../metrics";

export interface NotificationRecipient {
  role: string;
  address: string;
}

type NotificationChannel = "EMAIL" | "WEBHOOK";

function getChannel(): NotificationChannel | null {
  const ch = process.env.NOTIFICATION_CHANNEL?.trim().toUpperCase();
  if (ch === "EMAIL" || ch === "WEBHOOK") return ch;
  return null;
}

function buildEmailBody(
  event: string,
  recipient: NotificationRecipient,
  payload: Record<string, unknown>,
): { subject: string; text: string } {
  const bountyId = String(payload.bountyId ?? "");
  const title = String(payload.title ?? "");
  const amount = String(payload.amount ?? "");
  const token = String(payload.tokenSymbol ?? "");

  switch (event) {
    case "bounty_created":
      return {
        subject: `[Stellar Bounty Board] New bounty created: ${title}`,
        text: `A new bounty (${bountyId}) has been created.\n\nTitle: ${title}\nReward: ${amount} ${token}\n\nLog in to manage it.`,
      };
    case "bounty_reserved":
      return {
        subject: `[Stellar Bounty Board] Bounty ${bountyId} has been reserved`,
        text: `A contributor has reserved bounty ${bountyId}: "${title}".\n\nReward: ${amount} ${token}\n\nLog in to track their progress.`,
      };
    case "bounty_submitted":
      return {
        subject: `[Stellar Bounty Board] Solution submitted for bounty ${bountyId}`,
        text: `A solution has been submitted for bounty ${bountyId}: "${title}".\n\nSubmission URL: ${String(payload.submissionUrl ?? "N/A")}\n\nLog in to review and release or refund the reward.`,
      };
    case "bounty_released":
      return {
        subject: `[Stellar Bounty Board] Bounty ${bountyId} reward released`,
        text: `Congratulations! Your submission for bounty ${bountyId}: "${title}" has been approved and your reward of ${amount} ${token} has been released.`,
      };
    case "bounty_refunded":
      return {
        subject: `[Stellar Bounty Board] Bounty ${bountyId} has been refunded`,
        text: `The bounty ${bountyId}: "${title}" has been refunded. The reward of ${amount} ${token} has been returned to the maintainer.`,
      };
    case "bounty_disputed":
      return {
        subject: `[Stellar Bounty Board] Dispute raised for bounty ${bountyId}`,
        text: `A dispute has been raised for bounty ${bountyId}.\n\nReason: ${String(payload.reason ?? "N/A")}\n\nLog in to review the dispute.`,
      };
    case "dispute_stuck_alert":
      return {
        subject: `[Stellar Bounty Board] ACTION REQUIRED: Stuck disputed bounty ${bountyId}`,
        text: `The following bounty has been in "disputed" status for ${String(payload.hoursDisputed ?? "?")} hours, exceeding the resolution SLA.\n\nBounty: ${bountyId}\nTitle: ${title}\nRepository: ${String(payload.repo ?? "N/A")}\nContributor: ${String(payload.contributor ?? "N/A")}\nMaintainer: ${String(payload.maintainer ?? "N/A")}\nDisputed at: ${String(payload.disputedAt ?? "N/A")}\n\nPlease review and resolve this dispute promptly.`,
      };
    default:
      return {
        subject: `[Stellar Bounty Board] Notification: ${event}`,
        text: `A bounty event (${event}) occurred for bounty ${bountyId}.\n\nDetails:\n${JSON.stringify(payload, null, 2)}`,
      };
  }
}

async function dispatchEmail(
  recipients: NotificationRecipient[],
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const fromEmail =
    process.env.SENDGRID_FROM_EMAIL?.trim() ?? "noreply@stellarbountyboard.io";

  if (!apiKey) {
    logger.warn({ event }, "SENDGRID_API_KEY not set; skipping email notification");
    return;
  }

  await Promise.all(
    recipients.map(async (recipient) => {
      const { subject, text } = buildEmailBody(event, recipient, payload);

      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: recipient.address }] }],
          from: { email: fromEmail },
          subject,
          content: [{ type: "text/plain", value: text }],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`SendGrid responded ${response.status}: ${body}`);
      }
    }),
  );
}

async function dispatchWebhook(
  recipients: NotificationRecipient[],
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    logger.warn({ event }, "NOTIFICATION_WEBHOOK_URL not set; skipping webhook notification");
    return;
  }

  const body = JSON.stringify({ event, payload, recipients, timestamp: Date.now() });

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const secret = process.env.NOTIFICATION_WEBHOOK_SECRET?.trim();
  if (secret) {
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    headers["X-Bounty-Signature"] = `sha256=${sig}`;
  }

  const response = await fetch(webhookUrl, { method: "POST", headers, body });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Webhook responded ${response.status}: ${responseBody}`);
  }
}

// ── Retry configuration ────────────────────────────────────────────────────

/** Maximum number of dispatch attempts (1 initial + retries). */
const MAX_ATTEMPTS = (() => {
  const raw = parseInt(process.env.NOTIFICATION_MAX_ATTEMPTS ?? "3", 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 3;
})();

/** Base delay in milliseconds for exponential backoff. */
const BASE_DELAY_MS = (() => {
  const raw = parseInt(process.env.NOTIFICATION_RETRY_BASE_DELAY_MS ?? "1000", 10);
  return Number.isFinite(raw) && raw >= 100 ? raw : 1000;
})();

/** Jitter range as a fraction of the computed delay (0–1). */
const JITTER_FACTOR = 0.3;

/** Compute delay for attempt N (0-indexed) with exponential backoff + jitter. */
function computeBackoffDelay(attempt: number): number {
  const exponential = BASE_DELAY_MS * 2 ** attempt;
  const jitter = exponential * JITTER_FACTOR * Math.random();
  return Math.round(exponential + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dispatch a single notification through the configured channel.
 * This is the raw send that may throw on transient failures.
 */
async function dispatchSingle(
  channel: NotificationChannel,
  recipients: NotificationRecipient[],
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (channel === "EMAIL") {
    await dispatchEmail(recipients, event, payload);
  } else {
    await dispatchWebhook(recipients, event, payload);
  }
}

export async function sendNotification(
  recipients: NotificationRecipient[],
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const channel = getChannel();
  if (!channel) return;

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await dispatchSingle(channel, recipients, event, payload);
      // Success — emit retry metric if this was not the first attempt.
      if (attempt > 0) {
        notificationsRetriedTotal.inc({ channel, event }, attempt);
        logger.info(
          { event, channel, attempt: attempt + 1 },
          "Notification delivered after retry",
        );
      }
      return;
    } catch (err) {
      lastError = err;
      logger.warn(
        { event, channel, attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, err },
        "Notification dispatch attempt failed",
      );

      // Backoff before next attempt (skip on final attempt).
      if (attempt < MAX_ATTEMPTS - 1) {
        const delay = computeBackoffDelay(attempt);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted — send to dead-letter queue.
  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);

  notificationsFailedTotal.inc({ channel, event });

  logger.error(
    { event, channel, attemptCount: MAX_ATTEMPTS, errorMessage },
    "Notification failed after all retries; dead-lettering",
  );

  addToDeadLetter({
    channel,
    event,
    payload,
    recipients,
    lastError: errorMessage,
    attemptCount: MAX_ATTEMPTS,
    createdAt: Date.now(),
    lastAttemptAt: Date.now(),
    status: "pending",
  });
}

/**
 * Re-attempt a single dead-lettered notification.
 * Used by the admin replay endpoint.
 *
 * @returns `{ ok: true }` on success or `{ ok: false, error }` on failure.
 */
export async function retryNotification(
  channel: string,
  event: string,
  recipients: NotificationRecipient[],
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalizedChannel = channel.toUpperCase() as NotificationChannel;
  try {
    await dispatchSingle(normalizedChannel, recipients, event, payload);
    return { ok: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMessage };
  }
}
