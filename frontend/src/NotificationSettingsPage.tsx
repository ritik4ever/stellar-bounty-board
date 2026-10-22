import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Bell,
  Mail,
  Webhook,
  Smartphone,
  ArrowLeft,
  Save,
  AlertCircle,
} from 'lucide-react';
import { getNotificationPreferences, updateNotificationPreferences } from './api';
import type { NotificationPreferences } from './types';

const STORAGE_KEY_PREFIX = 'stellar-bounty-board-notification-preferences-';

const DEFAULT_EVENTS: Record<string, boolean> = {
  bounty_created: true,
  bounty_reserved: true,
  bounty_submitted: true,
  bounty_released: true,
  bounty_refunded: true,
  bounty_disputed: true,
};

const EVENT_LABELS: Record<string, { title: string; description: string }> = {
  bounty_created: {
    title: 'Bounty Created',
    description: 'Receive alerts when new bounties are funded and open for contribution.',
  },
  bounty_reserved: {
    title: 'Bounty Reserved',
    description: 'Notify when a contributor reserves a task.',
  },
  bounty_submitted: {
    title: 'Work Submitted',
    description: 'Get notified when pull requests or deliverables are submitted for review.',
  },
  bounty_released: {
    title: 'Payout Released',
    description: 'Receive instant alerts when bounty payouts are released to contributors.',
  },
  bounty_refunded: {
    title: 'Escrow Refunded',
    description: 'Notify when expired or cancelled bounties are refunded to maintainers.',
  },
  bounty_disputed: {
    title: 'Dispute Raised',
    description: 'Immediate alert when a bounty is flagged for arbitration.',
  },
};

interface NotificationSettingsPageProps {
  address?: string;
  onBack?: () => void;
}

export default function NotificationSettingsPage({
  address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  onBack,
}: NotificationSettingsPageProps) {
  const [optIn, setOptIn] = useState<boolean>(true);
  const [emailEnabled, setEmailEnabled] = useState<boolean>(true);
  const [email, setEmail] = useState<string>('');
  const [webhookEnabled, setWebhookEnabled] = useState<boolean>(false);
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [pushEnabled, setPushEnabled] = useState<boolean>(true);
  const [events, setEvents] = useState<Record<string, boolean>>(DEFAULT_EVENTS);

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load from local storage or backend
  useEffect(() => {
    let active = true;

    // Load initial local storage cache if available
    try {
      const cached = localStorage.getItem(`${STORAGE_KEY_PREFIX}${address}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (typeof parsed.optIn === 'boolean') setOptIn(parsed.optIn);
        if (parsed.channels) {
          setEmailEnabled(Boolean(parsed.channels.email));
          setWebhookEnabled(Boolean(parsed.channels.webhook));
          setPushEnabled(Boolean(parsed.channels.push));
        }
        if (parsed.email) setEmail(parsed.email);
        if (parsed.webhookUrl) setWebhookUrl(parsed.webhookUrl);
        if (parsed.events) setEvents((prev) => ({ ...prev, ...parsed.events }));
      }
    } catch {
      // ignore JSON parse error
    }

    // Fetch live preferences from backend
    setLoading(true);
    getNotificationPreferences(address)
      .then((data: NotificationPreferences) => {
        if (!active) return;
        setOptIn(data.optedIn ?? true);
        if (data.channels) {
          setEmailEnabled(data.channels.email ?? true);
          setWebhookEnabled(data.channels.webhook ?? false);
          setPushEnabled(data.channels.push ?? true);
        }
        if (data.preference?.email) setEmail(data.preference.email);
        if (data.preference?.webhookUrl) setWebhookUrl(data.preference.webhookUrl);
        if (data.events && Object.keys(data.events).length > 0) {
          setEvents((prev) => ({ ...prev, ...data.events }));
        }
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        // Non-blocking fallback: new users reflect default opt-in configuration
        setError(err instanceof Error ? err.message : 'Using default notification configuration');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [address]);

  const handleToggleEvent = useCallback((eventKey: string) => {
    setEvents((prev) => ({
      ...prev,
      [eventKey]: !prev[eventKey],
    }));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (emailEnabled && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error('Please enter a valid email address.');
      return;
    }

    if (webhookEnabled && webhookUrl.trim() && !/^https?:\/\//i.test(webhookUrl.trim())) {
      toast.error('Webhook URL must start with http:// or https://');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        optIn,
        optedIn: optIn,
        email: emailEnabled ? email.trim() : undefined,
        webhookUrl: webhookEnabled ? webhookUrl.trim() : undefined,
        channels: {
          email: emailEnabled,
          webhook: webhookEnabled,
          push: pushEnabled,
        },
        events,
      };

      await updateNotificationPreferences(address, payload);

      // Persist to local storage
      try {
        localStorage.setItem(
          `${STORAGE_KEY_PREFIX}${address}`,
          JSON.stringify({ ...payload, updatedAt: Date.now() })
        );
      } catch {
        // ignore
      }

      toast.success('Notification preferences saved successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save notification preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="notification-settings-page" data-testid="notification-settings-page">
      <div className="settings-header-nav">
        {onBack && (
          <button
            type="button"
            className="secondary-button back-button"
            onClick={onBack}
            data-testid="notification-back-button"
          >
            <ArrowLeft size={16} />
            <span>Back to Bounties</span>
          </button>
        )}
      </div>

      <div className="settings-container">
        <header className="settings-title-section">
          <div className="title-with-icon">
            <Bell className="settings-icon" size={28} />
            <div>
              <h2>Notification Preferences</h2>
              <p className="subtitle">
                Configure your real-time alerts across channels and bounty lifecycle events.
              </p>
            </div>
          </div>
          <div className="wallet-badge" title={address}>
            <span>Account:</span>
            <code>
              {address.slice(0, 6)}...{address.slice(-4)}
            </code>
          </div>
        </header>

        {loading && (
          <div className="loading-state" data-testid="settings-loading">
            <p>Loading notification preferences...</p>
          </div>
        )}

        {error && !loading && (
          <div className="info-banner" data-testid="settings-info-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="settings-form" data-testid="notification-form">
          {/* Master Opt-in Section */}
          <section className="settings-section master-toggle-section">
            <div className="section-header">
              <div>
                <h3>Master Notification Switch</h3>
                <p>Enable or disable all notifications for this account.</p>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  role="switch"
                  data-testid="master-opt-in-toggle"
                  checked={optIn}
                  onChange={(e) => setOptIn(e.target.checked)}
                  aria-label="Master notification opt-in"
                  aria-checked={optIn}
                />
                <span className="slider round"></span>
              </label>
            </div>
          </section>

          {/* Delivery Channels */}
          <section className="settings-section">
            <div className="section-title">
              <h3>Delivery Channels</h3>
              <p>Choose where you would like to receive bounty updates.</p>
            </div>

            <div className="channel-list">
              {/* Email Channel */}
              <div className="channel-item">
                <div className="channel-main">
                  <div className="channel-info">
                    <Mail size={20} className="channel-icon" />
                    <div>
                      <strong>Email Alerts</strong>
                      <p>Receive rich email summaries for key lifecycle transitions.</p>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      data-testid="channel-email-toggle"
                      checked={emailEnabled && optIn}
                      disabled={!optIn}
                      onChange={(e) => setEmailEnabled(e.target.checked)}
                      aria-label="Email notifications toggle"
                      aria-checked={emailEnabled && optIn}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
                {emailEnabled && optIn && (
                  <div className="channel-input-field">
                    <label htmlFor="email-input">Email Address</label>
                    <input
                      id="email-input"
                      type="email"
                      data-testid="channel-email-input"
                      placeholder="developer@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Webhook Channel */}
              <div className="channel-item">
                <div className="channel-main">
                  <div className="channel-info">
                    <Webhook size={20} className="channel-icon" />
                    <div>
                      <strong>Webhook Integration</strong>
                      <p>Post signed JSON payloads to your custom server endpoint or bot.</p>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      data-testid="channel-webhook-toggle"
                      checked={webhookEnabled && optIn}
                      disabled={!optIn}
                      onChange={(e) => setWebhookEnabled(e.target.checked)}
                      aria-label="Webhook notifications toggle"
                      aria-checked={webhookEnabled && optIn}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
                {webhookEnabled && optIn && (
                  <div className="channel-input-field">
                    <label htmlFor="webhook-input">Webhook URL</label>
                    <input
                      id="webhook-input"
                      type="url"
                      data-testid="channel-webhook-input"
                      placeholder="https://api.myproject.org/webhooks/bounties"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Browser Push */}
              <div className="channel-item">
                <div className="channel-main">
                  <div className="channel-info">
                    <Smartphone size={20} className="channel-icon" />
                    <div>
                      <strong>Browser & In-App Alerts</strong>
                      <p>Instant desktop and mobile push notifications via Web Push.</p>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      data-testid="channel-push-toggle"
                      checked={pushEnabled && optIn}
                      disabled={!optIn}
                      onChange={(e) => setPushEnabled(e.target.checked)}
                      aria-label="Browser push notifications toggle"
                      aria-checked={pushEnabled && optIn}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* Event Lifecycle Types */}
          <section className="settings-section">
            <div className="section-title">
              <h3>Bounty Lifecycle Events</h3>
              <p>Select which specific milestones trigger notification dispatches.</p>
            </div>

            <div className="events-grid">
              {Object.entries(EVENT_LABELS).map(([eventKey, info]) => {
                const isChecked = Boolean(events[eventKey] && optIn);
                return (
                  <div key={eventKey} className="event-item" data-testid={`event-item-${eventKey}`}>
                    <div className="event-info">
                      <strong>{info.title}</strong>
                      <p>{info.description}</p>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        role="switch"
                        data-testid={`event-toggle-${eventKey}`}
                        checked={isChecked}
                        disabled={!optIn}
                        onChange={() => handleToggleEvent(eventKey)}
                        aria-label={`${info.title} event toggle`}
                        aria-checked={isChecked}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Action footer */}
          <div className="settings-footer">
            <button
              type="submit"
              className="primary-button save-button"
              disabled={saving}
              data-testid="save-preferences-button"
            >
              <Save size={18} />
              <span>{saving ? 'Saving Preferences...' : 'Save Preferences'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
