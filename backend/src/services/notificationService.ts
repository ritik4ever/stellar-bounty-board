import crypto from "node:crypto";
import { logger } from "../logger";

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

export async function sendNotification(
  recipients: NotificationRecipient[],
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const channel = getChannel();
  if (!channel) return;

  try {
    if (channel === "EMAIL") {
      await dispatchEmail(recipients, event, payload);
    } else {
      await dispatchWebhook(recipients, event, payload);
    }
  } catch (err) {
    logger.error({ event, err }, "Notification dispatch failed");
  }
}
