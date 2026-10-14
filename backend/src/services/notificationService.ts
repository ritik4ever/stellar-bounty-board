import crypto from "node:crypto";
import { logger } from "../logger";

export interface NotificationRecipient {
  role: string;
  address: string;
}

type NotificationChannel = "EMAIL" | "WEBHOOK" | "SLACK";

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: string;
    text: string;
    emoji?: boolean;
  }>;
  elements?: Array<{
    type: string;
    text?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    url?: string;
    style?: string;
    value?: string;
    action_id?: string;
  }>;
}

export interface SlackAttachment {
  color?: string;
  blocks?: SlackBlock[];
}

export interface SlackPayload {
  text: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
}

export interface SlackBountyInput {
  id?: string;
  bountyId?: string;
  title?: string;
  amount?: number | string;
  tokenSymbol?: string;
  token?: string;
  status?: string;
  repo?: string;
  summary?: string;
  contributor?: string;
  maintainer?: string;
  submissionUrl?: string;
  reason?: string;
  [key: string]: unknown;
}

function getChannel(): NotificationChannel | null {
  const ch = process.env.NOTIFICATION_CHANNEL?.trim().toUpperCase();
  if (ch === "EMAIL" || ch === "WEBHOOK" || ch === "SLACK") return ch;
  return null;
}

export function buildSlackPayload(
  bounty: SlackBountyInput,
  eventType: string,
): SlackPayload {
  const bountyId = String(bounty.id ?? bounty.bountyId ?? "").trim();
  const title = String(bounty.title ?? "Untitled Bounty").trim();
  const amount = bounty.amount !== undefined ? String(bounty.amount) : "0";
  const tokenSymbol = String(bounty.tokenSymbol ?? bounty.token ?? "XLM").trim();
  const repo = bounty.repo ? String(bounty.repo).trim() : undefined;
  const summary = bounty.summary ? String(bounty.summary).trim() : undefined;
  const contributor = bounty.contributor ? String(bounty.contributor).trim() : undefined;
  const reason = bounty.reason ? String(bounty.reason).trim() : undefined;

  const frontendUrl = (process.env.FRONTEND_URL?.trim() || "https://stellar-bounty-board.vercel.app").replace(/\/+$/, "");
  const bountyUrl = bountyId ? `${frontendUrl}/bounties/${bountyId}` : frontendUrl;

  const normalizedEvent = eventType.toLowerCase().replace(/^bounty_/, "");

  let headerText = "Bounty Update";
  let color = "#4A154B";
  let defaultStatus = bounty.status ? String(bounty.status) : normalizedEvent;
  let buttonStyle: "primary" | "danger" | undefined = "primary";

  switch (normalizedEvent) {
    case "created":
      headerText = "✨ New Bounty Created";
      color = "#2EB886";
      defaultStatus = bounty.status ? String(bounty.status) : "open";
      break;
    case "reserved":
      headerText = "🎯 Bounty Reserved";
      color = "#3AA3E3";
      defaultStatus = bounty.status ? String(bounty.status) : "reserved";
      break;
    case "submitted":
      headerText = "📝 Solution Submitted";
      color = "#8957E5";
      defaultStatus = bounty.status ? String(bounty.status) : "submitted";
      break;
    case "disputed":
    case "dispute_stuck_alert":
      headerText = "⚠️ Bounty Disputed";
      color = "#E01E5A";
      defaultStatus = bounty.status ? String(bounty.status) : "disputed";
      buttonStyle = "danger";
      break;
    case "released":
      headerText = "🎉 Bounty Reward Released";
      color = "#2EB886";
      defaultStatus = bounty.status ? String(bounty.status) : "released";
      break;
    case "refunded":
      headerText = "↩️ Bounty Refunded";
      color = "#E8912D";
      defaultStatus = bounty.status ? String(bounty.status) : "refunded";
      buttonStyle = undefined;
      break;
    default:
      headerText = `📢 Bounty Event: ${eventType}`;
      color = "#4A154B";
      break;
  }

  const fields: Array<{ type: "mrkdwn"; text: string }> = [
    {
      type: "mrkdwn",
      text: `*Amount:*\n${amount} ${tokenSymbol}`,
    },
    {
      type: "mrkdwn",
      text: `*Status:*\n${defaultStatus}`,
    },
  ];

  if (bountyId) {
    fields.push({
      type: "mrkdwn",
      text: `*Bounty ID:*\n\`${bountyId}\``,
    });
  }

  if (repo) {
    fields.push({
      type: "mrkdwn",
      text: `*Repository:*\n${repo}`,
    });
  }

  if (contributor) {
    fields.push({
      type: "mrkdwn",
      text: `*Contributor:*\n\`${contributor}\``,
    });
  }

  if (reason) {
    fields.push({
      type: "mrkdwn",
      text: `*Reason:*\n${reason}`,
    });
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: headerText,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<${bountyUrl}|${title}>*` + (summary ? `\n${summary}` : ""),
      },
    },
    {
      type: "section",
      fields,
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Bounty",
            emoji: true,
          },
          url: bountyUrl,
          ...(buttonStyle ? { style: buttonStyle } : {}),
        },
      ],
    },
  ];

  return {
    text: `${headerText}: ${title} (${amount} ${tokenSymbol}) - ${bountyUrl}`,
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };
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

async function dispatchSlack(
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    logger.warn({ event }, "SLACK_WEBHOOK_URL not set; skipping slack notification");
    return;
  }

  const slackPayload = buildSlackPayload(payload, event);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slackPayload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Slack webhook responded ${response.status}: ${text}`);
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
    } else if (channel === "SLACK") {
      await dispatchSlack(event, payload);
    } else {
      await dispatchWebhook(recipients, event, payload);
    }
  } catch (err) {
    logger.error({ event, err }, "Notification dispatch failed");
  }
}
