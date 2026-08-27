import crypto from "node:crypto";
import { logger } from "../logger";

export interface NotificationRecipient {
  role: string;
  address: string;
}

type NotificationChannel = "EMAIL" | "WEBHOOK" | "DISCORD";

function getChannel(): NotificationChannel | null {
  const ch = process.env.NOTIFICATION_CHANNEL?.trim().toUpperCase();
  if (ch === "EMAIL" || ch === "WEBHOOK" || ch === "DISCORD") return ch;
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

export interface DiscordPayload {
  embeds: Array<{
    title: string;
    color: number;
    fields: Array<{ name: string; value: string; inline: boolean }>;
    footer?: { text: string };
    timestamp?: string;
  }>;
}

const EVENT_COLORS: Record<string, number> = {
  bounty_created: 0x3bbf6f, // green — new bounty available
  bounty_reserved: 0x5865f2, // blue — work in progress
  bounty_submitted: 0x9b59b6, // purple — awaiting review
  bounty_released: 0x2ecc71, // emerald — reward paid out
  bounty_refunded: 0x95a5a6, // gray — cancelled/returned
  bounty_disputed: 0xf39c12, // amber — needs attention
  dispute_stuck_alert: 0xe74c3c, // red — SLA exceeded
};

const EVENT_LABELS: Record<string, string> = {
  bounty_created: "New bounty",
  bounty_reserved: "Bounty reserved",
  bounty_submitted: "Solution submitted",
  bounty_released: "Reward released",
  bounty_refunded: "Bounty refunded",
  bounty_disputed: "Dispute raised",
  dispute_stuck_alert: "Stuck dispute alert",
};

/**
 * Builds a Discord webhook embed payload for a bounty event.
 * The returned body conforms to Discord's webhook embed schema.
 */
export function buildDiscordPayload(
  bounty: Record<string, unknown>,
  eventType: string,
): DiscordPayload {
  const title = String(bounty.title ?? "Untitled bounty");
  const bountyId = String(bounty.bountyId ?? "");
  const amount = String(bounty.amount ?? "");
  const token = String(bounty.tokenSymbol ?? "");
  const repo = String(bounty.repo ?? "N/A");
  const status = String(bounty.status ?? "N/A");

  const label = EVENT_LABELS[eventType] ?? eventType;
  const repoLink = repo !== "N/A" ? `https://github.com/${repo}` : repo;

  return {
    embeds: [
      {
        title: `${label}: ${title}`,
        color: EVENT_COLORS[eventType] ?? 0x7289da,
        fields: [
          { name: "Bounty ID", value: bountyId || "N/A", inline: true },
          {
            name: "Reward",
            value: amount ? `${amount} ${token}`.trim() : "N/A",
            inline: true,
          },
          { name: "Repository", value: repoLink, inline: false },
          { name: "Status", value: status, inline: true },
        ],
        footer: { text: "Stellar Bounty Board" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

async function dispatchDiscord(
  recipients: NotificationRecipient[],
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    logger.warn({ event }, "DISCORD_WEBHOOK_URL not set; skipping Discord notification");
    return;
  }

  const body = JSON.stringify(buildDiscordPayload(payload, event));

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Discord responded ${response.status}: ${responseBody}`);
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
    } else if (channel === "DISCORD") {
      await dispatchDiscord(recipients, event, payload);
    } else {
      await dispatchWebhook(recipients, event, payload);
    }
  } catch (err) {
    logger.error({ event, err }, "Notification dispatch failed");
  }
}
