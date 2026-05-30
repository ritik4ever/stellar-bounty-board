#!/usr/bin/env node

/**
 * Autocannon load test script for the Bounty Board backend.
 *
 * Seeds the store with test bounties, then runs a mixed read/write workload:
 *   70% GET /api/bounties
 *   20% GET /api/bounties/:id
 *   10% POST /api/bounties/:id/reserve
 *
 * Usage:
 *   node scripts/load-test.js [--connections 20] [--duration 30] [--bounties 20]
 *
 * Dependencies:
 *   npm install autocannon @faker-js/faker --save-dev
 *
 * Results:
 *   Prints p50, p99, max latency, error rate, and throughput.
 */

"use strict";

const autocannon = require("autocannon");

// ---------- CLI argument parsing ----------
function parseArgs() {
  const args = process.argv.slice(2);
  const flags = { connections: 20, duration: 30, bounties: 20 };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--connections":
      case "-c":
        flags.connections = parseInt(args[++i], 10);
        break;
      case "--duration":
      case "-d":
        flags.duration = parseInt(args[++i], 10);
        break;
      case "--bounties":
      case "-b":
        flags.bounties = parseInt(args[++i], 10);
        break;
      case "--help":
      case "-h":
        console.log(`
Usage: node scripts/load-test.js [options]

Options:
  --connections, -c  Number of concurrent connections (default: 20)
  --duration, -d     Test duration in seconds (default: 30)
  --bounties, -b     Number of test bounties to seed (default: 20)
  --help, -h         Show this help
`);
        process.exit(0);
    }
  }

  return flags;
}

// ---------- Seed helpers ----------
let seedCounter = Date.now();

function makeSeedBounty(index) {
  return {
    id: `loadtest-${seedCounter}-${index}`,
    repo: `stellar-loadtest/repo-${index % 5}`,
    issueNumber: 1000 + index,
    title: `Load test bounty #${index}`,
    summary: `This is a synthetic bounty created during autocannon load testing (seed ${index}).`,
    complexity: index % 3 === 0 ? "High" : index % 3 === 1 ? "Medium" : "Trivial",
    points: index % 3 === 0 ? 200 : index % 3 === 1 ? 150 : 100,
    tokenSymbol: "USDC",
    tokenAddress: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZP6X6HK4N6G6F2P7OXC",
    amount: "75",
    status: "open",
    maintainer: "GCLRXLDJ6DS6QTM4LQMJ6HNHLAFST7R4SWZWVVKHJ32PVMPLN33E2G47",
    createdAt: Math.floor(Date.now() / 1000) - 86400,
    deadline: Math.floor(Date.now() / 1000) + 86400 * 7,
    expectedVersion: 1,
  };
}

async function seedBounties(baseUrl, count) {
  const http = require("http");

  const results = [];
  for (let i = 0; i < count; i++) {
    const bounty = makeSeedBounty(i);
    await new Promise((resolve, reject) => {
      const data = JSON.stringify(bounty);
      const options = {
        hostname: new URL(baseUrl).hostname,
        port: new URL(baseUrl).port || 3001,
        path: "/api/bounties",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      };

      const req = http.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(body));
      });
      req.on("error", reject);
      req.write(data);
      req.end();
    });
    results.push(bounty);
  }
  return results;
}

// ---------- Workload URL generator ----------
// Returns a function that, when called, produces the next request
// matching the desired workload distribution.
function workloadGenerator(seedBounties) {
  const bountyIds = seedBounties.map((b) => b.id);
  let index = 0;

  return function nextRequest() {
    const roll = Math.random() * 100;

    if (roll < 70) {
      // 70% GET /api/bounties
      return { method: "GET", path: "/api/bounties" };
    }

    if (roll < 90) {
      // 20% GET /api/bounties/:id
      const id = bountyIds[index % bountyIds.length];
      index++;
      return { method: "GET", path: `/api/bounties/${encodeURIComponent(id)}` };
    }

    // 10% POST /api/bounties/:id/reserve
    const id = bountyIds[index % bountyIds.length];
    index++;
    const contributor = `GCLRXLDJ6DS6QTM4LQMJ6HNHLAFST7R4SWZWVVKHJ32PVMPLN33E${String(index % 100).padStart(2, "0")}`;
    return {
      method: "POST",
      path: `/api/bounties/${encodeURIComponent(id)}/reserve`,
      body: JSON.stringify({
        contributor,
        expectedVersion: 1,
      }),
      headers: { "Content-Type": "application/json" },
    };
  };
}

// ---------- Main ----------
async function main() {
  const flags = parseArgs();

  const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

  console.log(`\n=== Bounty Board Load Test ===`);
  console.log(`  Base URL:    ${BASE_URL}`);
  console.log(`  Connections:  ${flags.connections}`);
  console.log(`  Duration:     ${flags.duration}s`);
  console.log(`  Seed bounties: ${flags.bounties}`);
  console.log(`  Workload:     70% GET /api/bounties, 20% GET /api/bounties/:id, 10% POST /api/bounties/:id/reserve`);
  console.log(`\nSeeding ${flags.bounties} bounties...\n`);

  const seeded = await seedBounties(BASE_URL, flags.bounties);
  console.log(`  ✓ ${seeded.length} bounties seeded.\n`);

  const getNext = workloadGenerator(seeded);

  const instance = autocannon(
    {
      url: BASE_URL,
      connections: flags.connections,
      duration: flags.duration,
      requests: [
        {
          // Placeholder — we'll override with a custom generator
          method: "GET",
          path: "/api/bounties",
        },
      ],
      setupClient: (client) => {
        client.setBody("");

        client.on("request", () => {
          const req = getNext();
          client.setHeaders(
            Object.assign(
              { "Content-Type": "application/json" },
              req.headers || {},
            ),
          );
          client.setPath(req.path);
          client.setMethod(req.method || "GET");
          if (req.body) {
            client.setBody(req.body);
          } else {
            client.setBody("");
          }
        });
      },
    },
    (err, results) => {
      if (err) {
        console.error("Load test failed:", err);
        process.exit(1);
      }

      // Print results
      const latencies = results.latency;
      const requests = results.requests;

      console.log(`\n=== Results ===`);
      console.log(`  Duration:           ${results.duration}s`);
      console.log(`  Total requests:     ${requests.total}`);
      console.log(`  Requests/sec:       ${Math.round(requests.average)}`);
      console.log(`  Throughput (MB/s):  ${(results.throughput.average / 1024 / 1024).toFixed(2)}`);
      console.log("\n  Latency (ms):");
      console.log(`    p50:     ${latencies.p50}`);
      console.log(`    p90:     ${latencies.p90}`);
      console.log(`    p95:     ${latencies.p95}`);
      console.log(`    p99:     ${latencies.p99}`);
      console.log(`    max:     ${latencies.max}`);
      console.log("\n  Errors:");
      console.log(`    Timeouts:  ${results.timeouts}`);
      console.log(`    Errors:    ${results.errors}`);
      console.log(`    Non-2xx:   ${results.non2xx}`);
      console.log(`    Error rate: ${((results.errors + results.timeouts + results.non2xx) / Math.max(requests.total, 1) * 100).toFixed(2)}%`);
      console.log();
    },
  );

  // Track progress
  autocannon.track(instance, {
    renderProgressBar: true,
    renderResultsTable: true,
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
