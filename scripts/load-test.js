#!/usr/bin/env node
/**
 * Load-test script for Stellar Bounty Board backend.
 *
 * Usage:
 *   npm run load:test
 *   npm run load:test -- --connections 50 --duration 60 --bounties 40
 *
 * CLI flags:
 *   --connections  Number of concurrent connections (default: 20)
 *   --duration     Test duration in seconds         (default: 30)
 *   --bounties     Number of seed bounties           (default: 20)
 *   --url          Backend base URL                  (default: http://localhost:3001)
 */

"use strict";

const autocannon = require("autocannon");
const http = require("http");
const { randomUUID } = require("crypto");

// ─── CLI args ──────────────────────────────────────────────────────────────────
function parseArg(flag, defaultValue) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] !== undefined) {
    const val = process.argv[idx + 1];
    return typeof defaultValue === "number" ? Number(val) : val;
  }
  return defaultValue;
}

const BASE_URL    = parseArg("--url",         "http://localhost:3001");
const CONNECTIONS = parseArg("--connections", 20);
const DURATION    = parseArg("--duration",    30);
const NUM_BOUNTIES = parseArg("--bounties",   20);

// ─── Helpers ───────────────────────────────────────────────────────────────────
function request(options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, BASE_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port:     url.port || 3001,
        path:     url.pathname + (url.search || ""),
        method:   options.method || "GET",
        headers:  { "Content-Type": "application/json", ...(options.headers || {}) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── Seed bounties ─────────────────────────────────────────────────────────────
async function seedBounties(count) {
  console.log(`\n🌱  Seeding ${count} bounties...`);
  const ids = [];

  const STELLAR_PLACEHOLDER_PUBLIC_KEY =
    "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  for (let i = 0; i < count; i++) {
    const issueNumber = 1000 + i;
    const res = await request(
      { path: "/api/bounties", method: "POST" },
      {
        repo:        "stellar-bounty-board",
        issueNumber,
        title:       `Load test bounty #${issueNumber}`,
        amount:      "10",
        tokenSymbol: "XLM",
        maintainer:  STELLAR_PLACEHOLDER_PUBLIC_KEY,
      },
    );

    if (res.status === 201 && res.body?.data?.id) {
      ids.push(res.body.data.id);
    } else if (res.status === 409) {
      // already exists — recover the id if returned
      if (res.body?.data?.id) ids.push(res.body.data.id);
    }
  }

  console.log(`✅  Seeded ${ids.length} bounties.`);
  return ids;
}

// ─── Build autocannon request pipeline ────────────────────────────────────────
function buildRequests(ids) {
  if (ids.length === 0) {
    throw new Error("No bounty IDs available for the load test.");
  }

  // Weighted workload:
  //   70 % GET /api/bounties
  //   20 % GET /api/bounties/:id
  //   10 % POST /api/bounties/:id/reserve
  const requests = [];

  // 70 % — list
  for (let i = 0; i < 7; i++) {
    requests.push({ method: "GET", path: "/api/bounties" });
  }

  // 20 % — single fetch (cycle through available ids)
  for (let i = 0; i < 2; i++) {
    const id = ids[i % ids.length];
    requests.push({ method: "GET", path: `/api/bounties/${id}` });
  }

  // 10 % — reserve attempt (expect 400/409 but measures latency)
  {
    const id = ids[0];
    requests.push({
      method:  "POST",
      path:    `/api/bounties/${id}/reserve`,
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        contributor:     "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        expectedVersion: 0,
      }),
    });
  }

  return requests;
}

// ─── Pretty-print results ──────────────────────────────────────────────────────
function printResults(result) {
  const { latency, requests: rps, throughput, errors, non2xx } = result;

  const fmt = (v, unit = "") =>
    v !== undefined ? `${v.toFixed ? v.toFixed(2) : v}${unit}` : "n/a";

  console.log("\n══════════════════════════════════════════════");
  console.log("  📊  Load Test Results");
  console.log("══════════════════════════════════════════════");
  console.log(`  Connections  : ${CONNECTIONS}`);
  console.log(`  Duration     : ${DURATION}s`);
  console.log(`  Seed bounties: ${NUM_BOUNTIES}`);
  console.log("──────────────────────────────────────────────");
  console.log("  Latency (ms)");
  console.log(`    p50  : ${fmt(latency.p50)}`);
  console.log(`    p99  : ${fmt(latency.p99)}`);
  console.log(`    max  : ${fmt(latency.max)}`);
  console.log("──────────────────────────────────────────────");
  console.log("  Throughput");
  console.log(`    req/s  : ${fmt(rps.average)}`);
  console.log(`    bytes/s: ${fmt(throughput.average)} bytes`);
  console.log("──────────────────────────────────────────────");
  console.log(`  Errors      : ${errors}`);
  console.log(`  Non-2xx     : ${non2xx}`);
  console.log(`  Error rate  : ${fmt((errors / (rps.total || 1)) * 100)}%`);
  console.log("══════════════════════════════════════════════\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    // 1. Health check
    const health = await request({ path: "/api/health" });
    if (health.status !== 200) {
      console.error(
        `❌  Backend not reachable at ${BASE_URL} (status ${health.status}). ` +
        "Start the backend before running the load test.",
      );
      process.exit(1);
    }
    console.log(`✅  Backend healthy at ${BASE_URL}`);

    // 2. Seed bounties
    const ids = await seedBounties(NUM_BOUNTIES);

    // 3. Build workload
    const requests = buildRequests(ids);

    // 4. Run autocannon
    console.log(
      `\n🚀  Starting load test — ${CONNECTIONS} connections × ${DURATION}s…`,
    );

    const result = await autocannon({
      url:         BASE_URL,
      connections: CONNECTIONS,
      duration:    DURATION,
      requests,
      setupClient: (client) => {
        // rotate through requests round-robin
        client.setHeaders({ "Content-Type": "application/json" });
      },
    });

    // 5. Print summary
    printResults(result);

    process.exit(result.errors > 0 ? 1 : 0);
  } catch (err) {
    console.error("❌  Load test failed:", err.message);
    process.exit(1);
  }
})();
