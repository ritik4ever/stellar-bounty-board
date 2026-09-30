import { ReactNode } from "react";

interface ExpirationBadgeProps {
  deadlineAt: number; // Unix timestamp in seconds
}

type ExpirationStatus = "active" | "warning" | "critical" | "expired";

function getExpirationStatus(deadlineAt: number): ExpirationStatus {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadlineAt - now;
  const daysLeft = diff / (24 * 60 * 60);

  if (diff <= 0) return "expired";
  if (daysLeft <= 1) return "critical";
  if (daysLeft <= 3) return "warning";
  return "active";
}

function getStatusConfig(status: ExpirationStatus): {
  label: string;
  className: string;
  icon: ReactNode;
} {
  switch (status) {
    case "expired":
      return {
        label: "Expired",
        className: "expiration-badge expiration-badge--expired",
        icon: "⏰",
      };
    case "critical":
      return {
        label: "Due soon",
        className: "expiration-badge expiration-badge--critical",
        icon: "🔥",
      };
    case "warning":
      return {
        label: "Ending",
        className: "expiration-badge expiration-badge--warning",
        icon: "⚠️",
      };
    case "active":
      return {
        label: "Open",
        className: "expiration-badge expiration-badge--active",
        icon: "✅",
      };
  }
}

function formatTimeRemaining(deadlineAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadlineAt - now;
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h remaining`;
  return `${hours}h ${Math.floor((diff % 3600) / 60)}m remaining`;
}

export function ExpirationBadge({ deadlineAt }: ExpirationBadgeProps) {
  const status = getExpirationStatus(deadlineAt);
  const config = getStatusConfig(status);

  return (
    <span
      className={config.className}
      title={formatTimeRemaining(deadlineAt)}
      aria-label={`Status: ${config.label}. ${formatTimeRemaining(deadlineAt)}`}
    >
      <span aria-hidden="true">{config.icon}</span> {config.label}
    </span>
  );
}
