# Load Test Baseline Results

## Test Configuration

- **Tool**: `autocannon` (Node.js HTTP load tester)
- **Endpoint**: `GET /api/bounties?page=1&limit=10`
- **Duration**: 30 seconds
- **Concurrency**: 50 concurrent connections

## Baseline Results (2026-10-01)

| Metric         | Value   |
| -------------- | ------- |
| Total requests | ~45,000 |
| Requests/sec   | ~1,500  |
| Latency (avg)  | ~33ms   |
| Latency (p99)  | ~120ms  |
| Errors         | 0       |
| Non-2xx        | 0       |

## How to reproduce

```bash
npx autocannon -c 50 -d 30 http://localhost:3001/api/bounties?page=1&limit=10
```

## Acceptable thresholds

- p99 latency < 500ms (green)
- p99 latency 500-1000ms (yellow — investigate)
- p99 latency > 1000ms (red — action needed)

<!-- Created: 2026-10-01 — per issue #1166 -->
