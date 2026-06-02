import client from 'prom-client';

// Enable default metrics (process_cpu_seconds_total, process_resident_memory_bytes, etc.)
const collectDefaultMetrics = client.collectDefaultMetrics;

const globalMetricsState = globalThis as typeof globalThis & {
  __stellarBountyBoardMetricsInitialized?: boolean;
};

type HttpRequestDurationLabels = 'method' | 'route' | 'status_code';

function getOrCreateCounter(name: string, help: string): client.Counter<string> {
  const existing = client.register.getSingleMetric(name);
  if (!existing) {
    return new client.Counter({
      name,
      help,
      registers: [client.register],
    });
  }
  if (typeof (existing as { inc?: unknown }).inc === 'function') {
    return existing as client.Counter<string>;
  }
  throw new Error(`Metric "${name}" is already registered with a non-Counter type.`);
}

function getOrCreateHttpRequestDurationHistogram(): client.Histogram<HttpRequestDurationLabels> {
  const name = 'http_request_duration_seconds';
  const existing = client.register.getSingleMetric(name);
  if (!existing) {
    return new client.Histogram({
      name,
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [client.register],
    });
  }
  if (typeof (existing as { observe?: unknown }).observe === 'function') {
    return existing as client.Histogram<HttpRequestDurationLabels>;
  }
  throw new Error(`Metric "${name}" is already registered with a non-Histogram type.`);
}

if (!globalMetricsState.__stellarBountyBoardMetricsInitialized) {
  collectDefaultMetrics({ register: client.register });
  globalMetricsState.__stellarBountyBoardMetricsInitialized = true;
}

// Custom bounty counters
export const bountiesCreatedTotal = getOrCreateCounter(
  'bounties_created_total',
  'Total number of bounties created',
);

export const bountiesReleasedTotal = getOrCreateCounter(
  'bounties_released_total',
  'Total number of bounties released',
);

export const bountiesDisputedTotal = getOrCreateCounter(
  'bounties_disputed_total',
  'Total number of bounties disputed',
);

// HTTP request duration histogram
export const httpRequestDuration = getOrCreateHttpRequestDurationHistogram();

export async function getMetrics(): Promise<string> {
  return await client.register.metrics();
}
