#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const autocannon = require("autocannon");

const DEFAULT_STORE_PATH = path.join(process.cwd(), "backend", "data", "load-test-bounties.json");

const DEFAULTS = {
  bounties: 20,
  connections: 20,
  duration: 30,
  url: "http://127.0.0.1:3001",
};

const MAINTAINER = "GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK";
const CONTRIBUTORS = [
  "GBE6AZEUPV75O3Z7OFW4RIMU7DF453AVK5HCXB3PV2I7BBTYEPCOYWSF",
  "GAFQ647SLVQP5J3EIJGY4XARG4SPK2RMRNYPV7YYEIEUPGBMP6467B6E",
];

function parseArgs(argv) {
  const options = { ...DEFAULTS, startServer: true };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--no-start-server") {
      options.startServer = false;
      continue;
    }

    if (arg === "--url" && next) {
      options.url = next.replace(/\/$/, "");
      index += 1;
      continue;
    }

    for (const key of ["bounties", "connections", "duration"]) {
      if (arg === `--${key}` && next) {
        const parsed = Number(next);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error(`--${key} must be a positive integer.`);
        }
        options[key] = parsed;
        index += 1;
      }
    }
  }

  return options;
}

function startBackend() {
  const storePath = process.env.BOUNTY_STORE_PATH || DEFAULT_STORE_PATH;

  const child = spawn("npm", ["--prefix", "backend", "run", "dev"], {
    env: {
      ...process.env,
      BOUNTY_STORE_PATH: storePath,
      NODE_ENV: "test",
      PORT: process.env.PORT || "3001",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (process.env.LOAD_TEST_VERBOSE === "1") {
    child.stdout.on("data", (chunk) => process.stdout.write(`[backend] ${chunk}`));
    child.stderr.on("data", (chunk) => process.stderr.write(`[backend] ${chunk}`));
  }

  return child;
}

function resetDefaultStore() {
  if (process.env.BOUNTY_STORE_PATH) {
    return;
  }

  for (const filePath of [DEFAULT_STORE_PATH, DEFAULT_STORE_PATH.replace(/\.json$/, ".audit.json")]) {
    fs.rmSync(filePath, { force: true });
  }
}

function stopBackend(child) {
  if (!child) {
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function waitForHealth(url, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend did not become healthy within ${timeoutMs}ms.`);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`POST ${url} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload.data;
}

async function seedBounties(baseUrl, count) {
  const issueBase = Math.floor(Date.now() / 1000);
  const bounties = [];

  for (let index = 0; index < count; index += 1) {
    const bounty = await postJson(`${baseUrl}/api/bounties`, {
      repo: "ritik4ever/stellar-bounty-board",
      issueNumber: issueBase + index,
      title: `Load test seeded bounty ${index + 1}`,
      summary: "Synthetic bounty created by scripts/load-test.js for backend load testing.",
      maintainer: MAINTAINER,
      tokenSymbol: "XLM",
      amount: 1,
      deadlineDays: 7,
      labels: ["load-test"],
    });
    bounties.push(bounty);
  }

  return bounties;
}

function buildRequests(bounties) {
  let detailIndex = 0;
  let reserveIndex = 0;
  let contributorIndex = 0;

  return [
    { method: "GET", path: "/api/bounties", weight: 70 },
    {
      method: "GET",
      path: "/api/bounties",
      weight: 20,
      setupRequest(request) {
        const bounty = bounties[detailIndex % bounties.length];
        detailIndex += 1;
        return { ...request, path: `/api/bounties/${encodeURIComponent(bounty.id)}` };
      },
    },
    {
      method: "POST",
      path: "/api/bounties/:id/reserve",
      weight: 10,
      setupRequest(request) {
        const bounty = bounties[reserveIndex % bounties.length];
        const contributor = CONTRIBUTORS[contributorIndex % CONTRIBUTORS.length];
        reserveIndex += 1;
        contributorIndex += 1;
        return {
          ...request,
          path: `/api/bounties/${encodeURIComponent(bounty.id)}/reserve`,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contributor }),
        };
      },
    },
  ];
}

function printSummary(result) {
  const totalResponses = result["2xx"] + result.non2xx;
  const errorRate = totalResponses === 0
    ? 0
    : ((result.non2xx + result.errors) / totalResponses) * 100;

  console.log("\nLoad test summary");
  console.log(`p50 latency: ${result.latency.p50} ms`);
  console.log(`p99 latency: ${result.latency.p99} ms`);
  console.log(`max latency: ${result.latency.max} ms`);
  console.log(`error rate: ${errorRate.toFixed(2)}%`);
  console.log(`throughput: ${result.requests.average.toFixed(2)} req/sec`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let backend;

  try {
    if (options.startServer) {
      resetDefaultStore();
      backend = startBackend();
    }

    await waitForHealth(options.url);
    const bounties = await seedBounties(options.url, options.bounties);
    console.log(`Seeded ${bounties.length} bounties. Starting ${options.duration}s load test...`);

    const result = await autocannon({
      url: options.url,
      connections: options.connections,
      duration: options.duration,
      requests: buildRequests(bounties),
    });

    printSummary(result);
  } finally {
    stopBackend(backend);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
