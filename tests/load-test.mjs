import autocannon from 'autocannon';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DURATION = parseInt(process.env.DURATION || '30');
const CONNECTIONS = parseInt(process.env.CONNECTIONS || '10');

if (!Number.isFinite(DURATION) || DURATION <= 0) {
  console.error('❌ DURATION must be a positive integer');
  process.exit(1);
}
if (!Number.isFinite(CONNECTIONS) || CONNECTIONS <= 0) {
  console.error('❌ CONNECTIONS must be a positive integer');
  process.exit(1);
}

async function runLoadTest() {
  console.log(`Running load test against ${BASE_URL}`);
  console.log(`Duration: ${DURATION}s, Connections: ${CONNECTIONS}`);
  
  const result = await autocannon({
    url: BASE_URL,
    connections: CONNECTIONS,
    duration: DURATION,
    pipelining: 1,
    requests: [
      { method: 'GET', path: '/api/bounties' },
      { method: 'GET', path: '/api/bounties?status=open' },
      { method: 'GET', path: '/api/bounties?limit=10&offset=0' },
    ],
  });
  
  console.log('\n=== LOAD TEST RESULTS ===');
  console.log(`Requests/sec: ${result.requests.average}`);
  console.log(`Latency (avg): ${result.latency.average}ms`);
  console.log(`Latency (p99): ${result.latency.p99}ms`);
  console.log(`Throughput: ${result.throughput.average} bytes/sec`);
  console.log(`Errors: ${result.errors}`);
  console.log(`Timeouts: ${result.timeouts}`);
  
  if (result.errors > 0) {
    console.error('❌ FAIL: Load test produced errors');
    process.exit(1);
  }
  if (result.latency.p99 > 5000) {
    console.error('❌ FAIL: p99 latency exceeds 5000ms');
    process.exit(1);
  }
  console.log('✅ PASS: Load test passed all thresholds');
}

runLoadTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
