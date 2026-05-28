#!/usr/bin/env node
/**
 * autocannon-based load test for the Stellar Bounty Board backend.
 *
 * Seeds a configurable number of bounties and runs a mixed read/write workload.
 *
 * Usage:
 *   node scripts/load-test.js
 *   node scripts/load-test.js --connections 10 --duration 15 --bounties 50
 *
 * Environment:
 *   API_URL  – base URL of the backend (default: http://localhost:3001)
 */

const autocannon = require("autocannon");

// ── Configuration ────────────────────────────────────────────────────────────
const API_URL = process.env.API_URL || "http://localhost:3001";
const BOUNTIES_COUNT = parseCliFlag("--bounties") || 20;
const CONNECTIONS = parseCliFlag("--connections") || 20;
const DURATION = parseCliFlag("--duration") || 30;

const VERBOSE = process.argv.includes("--verbose");

// ── Helper ───────────────────────────────────────────────────────────────────
function parseCliFlag(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx === process.argv.length - 1) return null;
  return parseInt(process.argv[idx + 1], 10);
}

let bountyIds = [];

// ── Seed ─────────────────────────────────────────────────────────────────────
async function seedBounties(count) {
  console.log(`\n🌱 Seeding ${count} bounties...`);
  const ids = [];

  for (let i = 0; i < count; i++) {
    const body = {
      title: `Load test bounty #${i + 1}`,
      repo: `loadtest/bench-${(i % 5) + 1}`,
      issueNumber: 10000 + i,
      summary: `Auto-generated bounty for load testing (iteration ${i + 1}).`,
      maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      amount: Math.floor(Math.random() * 10000) + 100,
      tokenSymbol: ["XLM", "USDC", "EURC"][i % 3],
      deadlineDays: Math.floor(Math.random() * 30) + 1,
      labels: [],
    };

    try {
      const res = await fetch(`${API_URL}/api/bounties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        ids.push(data.id);
      } else {
        if (VERBOSE) console.error(`  ⚠️  Bounty ${i + 1} failed: ${res.status}`);
      }
    } catch {
      if (VERBOSE) console.error(`  ⚠️  Bounty ${i + 1} fetch error`);
    }
  }

  console.log(`✅ Seeded ${ids.length}/${count} bounties`);
  return ids;
}

// ── Load test ────────────────────────────────────────────────────────────────
function runLoadTest(ids) {
  return new Promise((resolve, reject) => {
    const idPool = ids.length > 0 ? ids : ["1"];
    let idx = 0;

    const instance = autocannon(
      {
        url: API_URL,
        connections: CONNECTIONS,
        duration: DURATION,
        requests: [
          {
            // 70%: GET /api/bounties
            method: "GET",
            path: "/api/bounties",
            weight: 70,
          },
          {
            // 20%: GET /api/bounties/:id
            method: "GET",
            path: () => `/api/bounties/${idPool[idx++ % idPool.length]}`,
            weight: 20,
          },
          {
            // 10%: POST /api/bounties/:id/reserve
            method: "POST",
            path: () => `/api/bounties/${idPool[idx++ % idPool.length]}/reserve`,
            weight: 10,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contributor: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            }),
          },
        ],
        setupClient: (client) => {
          client.setHeaders({ "Content-Type": "application/json" });
        },
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );

    // Progress updates
    if (VERBOSE) {
      autocannon.track(instance, { renderProgressBar: true });
    }
  });
}

// ── Report ────────────────────────────────────────────────────────────────────
function printReport(result) {
  const { latency, requests, errors, duration } = result;

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  📊 Load Test Results`);
  console.log(`  Duration:     ${duration}s`);
  console.log(`  Connections:  ${CONNECTIONS}`);
  console.log(`  Seeded:       ${BOUNTIES_COUNT} bounties`);
  console.log(`──────────────────────────────────────────`);
  console.log(`  Latency (ms):`);
  console.log(`    p50:      ${latency.p50.toFixed(2)}`);
  console.log(`    p90:      ${latency.p90.toFixed(2)}`);
  console.log(`    p99:      ${latency.p99.toFixed(2)}`);
  console.log(`    max:      ${latency.max.toFixed(2)}`);
  console.log(`──────────────────────────────────────────`);
  console.log(`  Throughput:`);
  console.log(`    Total requests: ${requests.total}`);
  console.log(`    Req/sec:        ${requests.average.toFixed(1)}`);
  console.log(`──────────────────────────────────────────`);
  console.log(`  Errors:`);
  console.log(`    Total:  ${errors}`);
  console.log(`    Rate:   ${((errors / requests.total) * 100).toFixed(2)}%`);
  console.log(`═══════════════════════════════════════════\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🚀 Starting load test`);
  console.log(`  Target:    ${API_URL}`);
  console.log(`  Bounties:  ${BOUNTIES_COUNT}`);
  console.log(`  Conns:     ${CONNECTIONS}`);
  console.log(`  Duration:  ${DURATION}s\n`);

  try {
    bountyIds = await seedBounties(BOUNTIES_COUNT);
  } catch (err) {
    console.error("Failed to seed bounties:", err.message);
    console.log("Proceeding with unseeded API...");
  }

  try {
    const result = await runLoadTest(bountyIds);
    printReport(result);
  } catch (err) {
    console.error("Load test failed:", err.message);
    process.exit(1);
  }
}

main();
