import type { RequestHandler } from "express";
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from "prom-client";
import type { GlobalMetrics } from "./services/bountyStore";

export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });

const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

const bountiesCreatedTotal = new Counter({
  name: "bounties_created_total",
  help: "Total number of bounties created.",
  registers: [metricsRegistry],
});

const bountiesReleasedTotal = new Counter({
  name: "bounties_released_total",
  help: "Total number of bounties released.",
  registers: [metricsRegistry],
});

const bountiesDisputedTotal = new Counter({
  name: "bounties_disputed_total",
  help: "Total number of bounties disputed.",
  registers: [metricsRegistry],
});

let observedCreatedTotal = 0;
let observedReleasedTotal = 0;
let observedDisputedTotal = 0;

function advanceCounter(counter: Counter<string>, current: number, next: number): number {
  if (next > current) {
    counter.inc(next - current);
    return next;
  }
  return current;
}

export function syncBountyMetrics(metrics: GlobalMetrics): void {
  observedCreatedTotal = advanceCounter(
    bountiesCreatedTotal,
    observedCreatedTotal,
    metrics.totalBounties,
  );
  observedReleasedTotal = advanceCounter(
    bountiesReleasedTotal,
    observedReleasedTotal,
    metrics.releasedCount,
  );
  observedDisputedTotal = advanceCounter(
    bountiesDisputedTotal,
    observedDisputedTotal,
    0,
  );
}

export function createHttpMetricsMiddleware(): RequestHandler {
  return (req, res, next) => {
    const endTimer = httpRequestDuration.startTimer();

    res.on("finish", () => {
      endTimer({
        method: req.method,
        route: req.route?.path ?? req.path ?? "unknown",
        status_code: String(res.statusCode),
      });
    });

    next();
  };
}
