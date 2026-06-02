import client from 'prom-client';

// Enable default metrics (process_cpu_seconds_total, process_resident_memory_bytes, etc.)
const collectDefaultMetrics = client.collectDefaultMetrics;

collectDefaultMetrics({ register: client.register });

// Custom bounty counters
export const bountiesCreatedTotal = new client.Counter({
  name: 'bounties_created_total',
  help: 'Total number of bounties created',
  registers: [client.register],
});

export const bountiesReleasedTotal = new client.Counter({
  name: 'bounties_released_total',
  help: 'Total number of bounties released',
  registers: [client.register],
});

export const bountiesDisputedTotal = new client.Counter({
  name: 'bounties_disputed_total',
  help: 'Total number of bounties disputed',
  registers: [client.register],
});

// HTTP request duration histogram
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [client.register],
});

export async function getMetrics(): Promise<string> {
  return await client.register.metrics();
}
