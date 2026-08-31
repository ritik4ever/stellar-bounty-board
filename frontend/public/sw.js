// Stellar Bounty Board — Service Worker
// Handles push notifications and precaching.

/// <reference lib="webworker" />

self.__WB_MANIFEST = self.__WB_MANIFEST || [];

// ── Install / Activate ──────────────────────────────────────────
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── Push Notifications ──────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    // Not JSON — try plain text fallback
    const text = event.data.text();
    if (!text) return;
    data = { title: 'Stellar Bounty Board', body: text };
  }

  const {
    title = 'Stellar Bounty Board',
    body = '',
    icon = '/icons/icon-192.png',
    badge = '/icons/icon-192.png',
    tag = 'bounty-status-change',
    url = '/',
    ...rest
  } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      data: { url },
      vibrate: [200, 100, 200],
      ...rest,
    })
  );
});

// ── Notification Click ──────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url ?? '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // If a window client exists, focus it and navigate
        for (const client of windowClients) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.focus();
            client.navigate(urlToOpen);
            return;
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});