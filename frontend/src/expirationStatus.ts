import { BountyStatus } from "./types";

const DAY_SECONDS = 24 * 60 * 60;

export type ExpirationBadgeStatus = BountyStatus | "disputed";
export type ExpirationBadgeTone = "green" | "yellow" | "red" | "grey" | "blue" | "default";

export interface ExpirationStatusBadge {
  tone: ExpirationBadgeTone;
  className: string;
  label: string;
  title: string;
  ariaLabel: string;
}

const STATUS_LABELS: Record<ExpirationBadgeStatus, string> = {
  open: "Open",
  reserved: "Reserved",
  submitted: "Submitted",
  released: "Released",
  refunded: "Refunded",
  expired: "Expired",
  disputed: "Disputed",
};

function makeBadge(status: ExpirationBadgeStatus, tone: ExpirationBadgeTone, detail: string): ExpirationStatusBadge {
  const label = `${STATUS_LABELS[status]} - ${detail}`;
  const title = `${STATUS_LABELS[status]}: ${detail}`;

  return {
    tone,
    className:
      tone === "default"
        ? `status-pill status-pill--${status}`
        : `status-pill status-pill--expiration-${tone}`,
    label,
    title,
    ariaLabel: title,
  };
}

export function getExpirationStatusBadge(
  status: ExpirationBadgeStatus,
  deadlineAt: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): ExpirationStatusBadge {
  if (status === "disputed") {
    return makeBadge(status, "blue", "under dispute");
  }

  if (status === "expired" || status === "released" || status === "refunded") {
    return makeBadge(status, "grey", "closed");
  }

  if (status !== "open" && status !== "reserved") {
    return makeBadge(status, "default", "in review");
  }

  const secondsRemaining = deadlineAt - nowSeconds;

  if (secondsRemaining < DAY_SECONDS) {
    return makeBadge(status, "red", "less than 24 hours left");
  }

  if (secondsRemaining <= 7 * DAY_SECONDS) {
    return makeBadge(status, "yellow", "1-7 days left");
  }

  return makeBadge(status, "green", "more than 7 days left");
}
