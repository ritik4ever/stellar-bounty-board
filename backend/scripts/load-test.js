#!/usr/bin/env node
import autocannon from "autocannon";
import { parseArgs } from "node:util";

const options = parseArgs({
  options: {
    connections: { type: "string", default: "20" },
    duration: { type: "string", default: "30" },
    bounties: { type: "string", default: "20" },
  },
});

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3001";
const CONNECTIONS = Number(options.values.connections);
const DURATION = Number(options.values.duration);
const BOUNTY_COUNT = Number(options.values.bounties);

async function seedBounties(count) {
  const created = [];
  for (let i = 0; i < count; i++) {
    const res = await fetch(`${BASE_URL}/api/bounties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: "acme/widget",
        issueNumber: 1000 + i,
        title: `Load test bounty #${i}`,
        summary: `Auto-generated load test bounty ${i}`,
        maintainer: "GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK",
        tokenSymbol: "XLM",
        amount: 10,
        deadlineDays: 30,
        labels: ["load-test"],
      }),
    });
    let body;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = {}; }
    created.push(body?.id ?? body?.bounty?.id ?? `bounty-${i}`);
  }
  return created.filter(Boolean);
}

async function runLoadTest(bountyIds) {
  const getId = () => bountyIds[Math.floor(Math.random() * bountyIds.length)];

  const instance = autocannon(
    {
      url: BASE_URL,
      connections: CONNECTIONS,
      duration: DURATION,
      requests: [
        {
          method: "GET",
          path: "/api/bounties",
          weight: 70,
        },
        {
          method: "GET",
          path: () => `/api/bounties/${getId()}`,
          weight: 20,
          onResponse: (status, body, context) => {
            context.bountyId = undefined;
          },
        },
        {
          method: "POST",
          path: () => `/api/bounties/${getId()}/reserve`,
          weight: 10,
          body: () =>
            JSON.stringify({
              contributor: "GBE6AZEUPV75O3Z7OFW4RIMU7DF453AVK5HCXB3PV2I7BBTYEPCOYWSF",
            }),
          headers: { "Content-Type": "application/json" },
        },
      ],
    },
    (err, result) => {
      if (err) {
        console.error("Load test failed:", err);
        process.exit(1);
      }
      printResults(result);
    }
  );

  instance.on("tick", () => process.stdout.write("."));
}

function printResults(result) {
  console.log("\n\n=== Load Test Results ===");
  console.log(`Duration: ${result.duration}s`);
  console.log(`Connections: ${result.connections}`);
  console.log(`\n--- Latency (ms) ---`);
  console.log(`p50:  ${result.latency.p50?.toFixed(2) ?? "N/A"}`);
  console.log(`p99:  ${result.latency.p99?.toFixed(2) ?? "N/A"}`);
  console.log(`max:  ${result.latency.max?.toFixed(2) ?? "N/A"}`);
  console.log(`\n--- Errors ---`);
  console.log(`Rate: ${(result.errors / result.requests.total * 100).toFixed(2)}%`);
  console.log(`Count: ${result.errors}`);
  console.log(`\n--- Throughput ---`);
  console.log(`Requests: ${result.requests.total}`);
  console.log(`Throughput: ${(result.throughput?.total ?? 0) / 1024 / 1024} MB`);
  console.log(`\n--- Requests/sec ---`);
  const rps = result.requests.average ?? 0;
  console.log(`Avg: ${rps.toFixed(2)} req/s`);
}

async function main() {
  console.log(`Seeding ${BOUNTY_COUNT} bounties...`);
  const bountyIds = await seedBounties(BOUNTY_COUNT);
  console.log(`Seeded ${bountyIds.length} bounties`);

  console.log(`\nRunning load test: ${CONNECTIONS} connections, ${DURATION}s`);
  console.log("Progress: ");
  await runLoadTest(bountyIds);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
