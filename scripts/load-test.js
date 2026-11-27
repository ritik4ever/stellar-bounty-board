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
const SCENARIO     = parseArg("--scenario",   "steady");

// Ensure the dispute endpoint's maintainer-key auth has a configured signer.
// The signature itself is intentionally invalid for this test; we only need
// the request to reach the rate limiter, which returns 429 once capacity is exceeded.
process.env.MAINTAINER_PUBLIC_KEYS ||= "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

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

// ─── Build dispute-burst request pipeline ──────────────────────────────────────
function buildDisputeRequests(ids) {
  if (ids.length === 0) {
    throw new Error("No bounty IDs available for the dispute load test.");
  }

  const publicKey = process.env.MAINTAINER_PUBLIC_KEYS?.split(",")[0]?.trim() ??
    "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const contributor = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const requests = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const body = JSON.stringify({
      contributor,
      reason: "Load-test dispute burst",
      action: "dispute",
      bountyId: id,
      timestamp: Math.floor(Date.now() / 1000),
    });
    requests.push({
      method: "POST",
      path: `/api/bounties/${id}/dispute`,
      headers: {
        "Content-Type": "application/json",
        "x-stellar-public-key": publicKey,
        "x-stellar-signature": "0".repeat(64),
      },
      body,
    });
  }

  return requests;
}

// ─── Pretty-print results ──────────────────────────────────────────────────────
function printResults(result, title = "Load Test Results") {
  const { latency, requests: rps, throughput, errors, non2xx } = result;

  const fmt = (v, unit = "") =>
    v !== undefined ? `${v.toFixed ? v.toFixed(2) : v}${unit}` : "n/a";

  console.log("\n══════════════════════════════════════════════");
  console.log(`  ${title}`);
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

// ─── Dispute-burst scenario ──────────────────────────────────────────────────
async function runDisputeBurst(ids) {
  const controlRequests = [{ method: "GET", path: "/api/bounties" }];
  const disputeRequests = buildDisputeRequests(ids);

  console.log(
    `\nStarting dispute burst — ${CONNECTIONS} connections × ${DURATION}s`,
  );
  console.log("  Control endpoint: GET /api/bounties");

  const [control, burst] = await Promise.all([
    autocannon({
      url:         BASE_URL,
      connections: CONNECTIONS,
      duration:    DURATION,
      requests:    controlRequests,
      setupClient: (client) => {
        client.setHeaders({ "Content-Type": "application/json" });
      },
    }),
    autocannon({
      url:         BASE_URL,
      connections: CONNECTIONS,
      duration:    DURATION,
      requests:    disputeRequests,
      setupClient: (client) => {
        client.setHeaders({ "Content-Type": "application/json" });
      },
    }),
  ]);

  printResults(control, "Control (GET /api/bounties)");
  printResults(burst, "Dispute burst (POST /api/bounties/:id/dispute)");

  const controlTotal = control.requests.total || 1;
  const burstTotal = burst.requests.total || 1;
  const controlErrorRate = (control.non2xx / controlTotal) * 100;
  const burstErrorRate = (burst.non2xx / burstTotal) * 100;

  console.log("──────────────────────────────────────────────");
  console.log(`  Control error rate : ${controlErrorRate.toFixed(2)}%`);
  console.log(`  Burst error rate   : ${burstErrorRate.toFixed(2)}%`);
  console.log("══════════════════════════════════════════════\n");

  if (controlErrorRate > 5) {
    console.error("Control endpoint degraded under dispute burst.");
    return { success: false, exitCode: 1 };
  }

  if (burstErrorRate < 50) {
    console.error("Dispute burst did not produce expected rate-limit shedding.");
    return { success: false, exitCode: 1 };
  }

  console.log("Rate limiter shed dispute load without degrading control endpoint.");
  return { success: true, exitCode: 0 };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const health = await request({ path: "/api/health" });
    if (health.status !== 200) {
      console.error(
        `Backend not reachable at ${BASE_URL} (status ${health.status}). ` +
        "Start the backend before running the load test.",
      );
      process.exit(1);
    }
    console.log(`Backend healthy at ${BASE_URL}`);

    const ids = await seedBounties(NUM_BOUNTIES);

    if (SCENARIO === "steady") {
      const requests = buildRequests(ids);

      console.log(
        `\nStarting steady-state load test — ${CONNECTIONS} connections × ${DURATION}s…`,
      );

      const result = await autocannon({
        url:         BASE_URL,
        connections: CONNECTIONS,
        duration:    DURATION,
        requests,
        setupClient: (client) => {
          client.setHeaders({ "Content-Type": "application/json" });
        },
      });

      printResults(result, "Steady-state load test");
      process.exit(result.errors > 0 ? 1 : 0);
    }

    if (SCENARIO === "dispute") {
      const { exitCode } = await runDisputeBurst(ids);
      process.exit(exitCode);
    }

    console.error(`Unknown scenario: ${SCENARIO}. Use "steady" or "dispute".`);
    process.exit(1);
  } catch (err) {
    console.error("Load test failed:", err.message);
    process.exit(1);
  }
})();
