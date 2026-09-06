import { randomUUID } from "node:crypto";

export interface StreamFilter {
  bountyId?: string;
  maintainerAddress?: string;
}

interface Subscriber {
  id: string;
  filters: StreamFilter;
  send: (chunk: string) => void;
}

export interface BusEvent {
  id: number;
  event: string;
  payload: Record<string, unknown>;
  bountyId?: string;
  maintainerAddress?: string;
  timestamp: number;
}

const HISTORY_LIMIT = 100;

export class EventBus {
  private subscribers = new Set<Subscriber>();
  private history: BusEvent[] = [];
  private nextId = 1;

  subscribe(filters: StreamFilter, send: (chunk: string) => void): () => void {
    const id = randomUUID();
    const subscriber: Subscriber = { id, filters, send };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  publish(event: string, payload: Record<string, unknown>, meta?: { bountyId?: string; maintainerAddress?: string }): void {
    const bountyId = meta?.bountyId ?? (typeof payload.bountyId === "string" ? payload.bountyId : undefined);
    const maintainerAddress =
      meta?.maintainerAddress ??
      (typeof payload.maintainerAddress === "string" ? payload.maintainerAddress : undefined) ??
      (typeof payload.maintainer === "string" ? payload.maintainer : undefined);

    const busEvent: BusEvent = {
      id: this.nextId++,
      event,
      payload,
      bountyId,
      maintainerAddress,
      timestamp: Date.now(),
    };

    this.history.push(busEvent);
    if (this.history.length > HISTORY_LIMIT) {
      this.history.shift();
    }

    for (const subscriber of this.subscribers) {
      if (matches(subscriber.filters, busEvent)) {
        const chunk = `id: ${busEvent.id}\nevent: ${busEvent.event}\ndata: ${JSON.stringify(busEvent.payload)}\n\n`;
        try {
          subscriber.send(chunk);
        } catch (err) {
          this.subscribers.delete(subscriber);
        }
      }
    }
  }

  getHistorySince(sinceId: number, filters?: StreamFilter): BusEvent[] {
    return this.history.filter((event) => event.id > sinceId && (!filters || matches(filters, event)));
  }
}

function matches(filters: StreamFilter, event: BusEvent): boolean {
  if (filters.bountyId && event.bountyId && filters.bountyId !== event.bountyId) return false;
  if (filters.maintainerAddress && event.maintainerAddress && filters.maintainerAddress !== event.maintainerAddress) return false;
  return true;
}

export const eventBus = new EventBus();