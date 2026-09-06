self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { event: 'unknown', payload: {} };
  }

  const { event: eventType, payload } = data;
  const title = getTitle(eventType, payload);
  const options = {
    body: getBody(eventType, payload),
    icon: '/icon.png',
    badge: '/badge.png',
    data: { url: getUrl(payload) },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});

function getTitle(event, payload) {
  const titles = {
    bounty_created: 'New bounty created',
    bounty_reserved: 'Bounty reserved',
    bounty_submitted: 'Solution submitted',
    bounty_released: 'Reward released',
    bounty_refunded: 'Bounty refunded',
    bounty_disputed: 'Dispute raised',
    dispute_stuck_alert: 'Action required: stuck dispute',
  };
  return titles[event] || 'Bounty update';
}

function getBody(event, payload) {
  const bountyId = payload?.bountyId ?? '';
  const title = payload?.title ?? '';
  switch (event) {
    case 'bounty_created':
      return `A new bounty "${title}" has been created.`;
    case 'bounty_reserved':
      return `Bounty ${bountyId} has been reserved.`;
    case 'bounty_submitted':
      return `A solution has been submitted for bounty ${bountyId}.`;
    case 'bounty_released':
      return `Your reward for bounty ${bountyId} has been released!`;
    case 'bounty_refunded':
      return `Bounty ${bountyId} has been refunded.`;
    case 'bounty_disputed':
      return `A dispute has been raised for bounty ${bountyId}.`;
    case 'dispute_stuck_alert':
      return `Bounty ${bountyId} has been stuck in dispute.`;
    default:
      return `A bounty update occurred.`;
  }
}

function getUrl(payload) {
  const bountyId = payload?.bountyId;
  return bountyId ? `/bounties/${bountyId}` : '/';
}
