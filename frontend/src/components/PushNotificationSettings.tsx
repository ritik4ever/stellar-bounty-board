/**
 * PushNotificationSettings – Opt-in/opt-out control for browser push notifications.
 *
 * Shows:
 *  - A "Subscribe" button when not subscribed (triggers permission request)
 *  - A "Subscribed" badge with unsubscribe option when subscribed
 *  - A loading state during async operations
 *  - Support indicator when push is not available
 */

import { Bell, BellOff, BellRing, Loader } from "lucide-react";
import { usePushNotifications } from "../hooks/usePushNotifications";

export default function PushNotificationSettings() {
  const {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    error,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  // Not supported — don't render anything
  if (!isSupported) return null;

  // Permission denied — show a subtle indicator
  if (permission === "denied") {
    return (
      <div
        className="push-notification-setting"
        title="Notifications are blocked in browser settings"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 12px",
          borderRadius: "6px",
          fontSize: "13px",
          opacity: 0.5,
          cursor: "not-allowed",
        }}
      >
        <BellOff size={16} />
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div
        className="push-notification-setting"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 12px",
          borderRadius: "6px",
          fontSize: "13px",
        }}
      >
        <Loader size={16} className="push-spinner" />
      </div>
    );
  }

  // Subscribed — show unsubscribe option
  if (isSubscribed) {
    return (
      <div
        className="push-notification-setting"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 12px",
          borderRadius: "6px",
          fontSize: "13px",
          backgroundColor: "var(--mint-soft, #dff8ef)",
          color: "var(--mint, #1e8f6f)",
        }}
      >
        <BellRing size={16} />
        <span>Notifications On</span>
        <button
          type="button"
          className="ghost-button"
          onClick={() => {
            unsubscribe().catch(() => {});
          }}
          style={{ fontSize: "12px", padding: "2px 8px", marginLeft: "4px" }}
          aria-label="Turn off push notifications"
          disabled={isLoading}
        >
          Turn Off
        </button>
      </div>
    );
  }

  // Not subscribed — show subscribe button
  return (
    <div className="push-notification-setting" style={{ display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          subscribe().catch(() => {});
        }}
        disabled={isLoading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "13px",
        }}
        aria-label="Enable push notifications for bounty status changes"
      >
        {isLoading ? (
          <>
            <Loader size={16} className="push-spinner" />
            Subscribing...
          </>
        ) : (
          <>
            <Bell size={16} />
            Notifications
          </>
        )}
      </button>
      {error && (
        <span
          style={{
            marginLeft: "8px",
            fontSize: "12px",
            color: "var(--rose, #b8554b)",
            maxWidth: "200px",
          }}
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}