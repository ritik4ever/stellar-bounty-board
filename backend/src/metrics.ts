import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

export const register = new Registry();

try {
  if (!register.getSingleMetric("process_cpu_user_seconds_total")) {
    collectDefaultMetrics({ register });
  }
} catch {
  // Prevent duplicate metric registration crashes during test module reloads.
}

function getOrCreateCounter(name: string, help: string): Counter<string> {
  const existing = register.getSingleMetric(name);

  if (existing) {
    return existing as Counter<string>;
  }

  return new Counter({
    name,
    help,
    registers: [register],
  });
}

function getOrCreateHistogram(name: string, help: string): Histogram<string> {
  const existing = register.getSingleMetric(name);

  if (existing) {
    return existing as Histogram<string>;
  }

  return new Histogram({
    name,
    help,
    labelNames: ["method", "route", "status_code"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
  });
}

export const bountiesCreatedTotal = getOrCreateCounter(
  "bounties_created_total",
  "Total number of bounties created",
);

export const bountiesReleasedTotal = getOrCreateCounter(
  "bounties_released_total",
  "Total number of bounties released",
);

export const bountiesDisputedTotal = getOrCreateCounter(
  "bounties_disputed_total",
  "Total number of bounties disputed",
);

export const httpRequestDuration = getOrCreateHistogram(
  "http_request_duration_seconds",
  "Duration of HTTP requests in seconds",
);

export async function getMetrics(): Promise<string> {
  return register.metrics();
}
