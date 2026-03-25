export type NotificationEvent =
  | "bounty_reserved"
  | "bounty_submitted"
  | "bounty_released"
  | "bounty_refunded";

export interface NotificationPayload {
  event: NotificationEvent;
  bountyId: string;
  repo: string;
  issueNumber: number;
  title: string;
  maintainer: string;
  contributor?: string;
  amount: number;
  tokenSymbol: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface NotificationService {
  send(payload: NotificationPayload): Promise<void>;
}

class ConsoleNotificationService implements NotificationService {
  async send(payload: NotificationPayload): Promise<void> {
    const { event, bountyId, repo, issueNumber, title, maintainer, contributor, amount, tokenSymbol } = payload;
    const target = contributor || maintainer;
    
    console.log(`[NOTIFICATION] ${event.toUpperCase()}`);
    console.log(`  Bounty: ${bountyId} (${repo}#${issueNumber})`);
    console.log(`  Title: ${title}`);
    console.log(`  Amount: ${amount} ${tokenSymbol}`);
    console.log(`  Target: ${target}`);
    console.log(`  Timestamp: ${new Date(payload.timestamp * 1000).toISOString()}`);
    
    if (payload.metadata) {
      console.log(`  Metadata:`, payload.metadata);
    }
  }
}

class WebhookNotificationService implements NotificationService {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(payload: NotificationPayload): Promise<void> {
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(`[NOTIFICATION] Webhook failed with status ${response.status}`);
      }
    } catch (error) {
      // Fail silently - notifications should not break core functionality
      console.warn(`[NOTIFICATION] Webhook error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

class CompositeNotificationService implements NotificationService {
  private services: NotificationService[];

  constructor(services: NotificationService[]) {
    this.services = services;
  }

  async send(payload: NotificationPayload): Promise<void> {
    // Send to all services in parallel, fail silently
    await Promise.all(
      this.services.map(async (service) => {
        try {
          await service.send(payload);
        } catch (error) {
          console.warn(`[NOTIFICATION] Service failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      })
    );
  }
}

// Factory function to create notification service based on environment
export function createNotificationService(): NotificationService {
  const services: NotificationService[] = [];

  // Always add console logging in development
  if (process.env.NODE_ENV !== "production") {
    services.push(new ConsoleNotificationService());
  }

  // Add webhook if configured
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (webhookUrl) {
    services.push(new WebhookNotificationService(webhookUrl));
  }

  // If no services configured, default to console
  if (services.length === 0) {
    services.push(new ConsoleNotificationService());
  }

  return new CompositeNotificationService(services);
}

// Singleton instance
let notificationService: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!notificationService) {
    notificationService = createNotificationService();
  }
  return notificationService;
}

// For testing - allow service injection
export function setNotificationService(service: NotificationService): void {
  notificationService = service;
}

// Helper to create notification payload from bounty record
export function createNotificationPayload(
  event: NotificationEvent,
  bounty: {
    id: string;
    repo: string;
    issueNumber: number;
    title: string;
    maintainer: string;
    contributor?: string;
    amount: number;
    tokenSymbol: string;
  },
  metadata?: Record<string, unknown>
): NotificationPayload {
  return {
    event,
    bountyId: bounty.id,
    repo: bounty.repo,
    issueNumber: bounty.issueNumber,
    title: bounty.title,
    maintainer: bounty.maintainer,
    contributor: bounty.contributor,
    amount: bounty.amount,
    tokenSymbol: bounty.tokenSymbol,
    timestamp: Math.floor(Date.now() / 1000),
    metadata,
  };
}
