#!/usr/bin/env node
/**
 * check-latency-regression.js
 *
 * Compares p99 latency from the current autocannon run against stored baselines
 * and fails (exit 1) if any endpoint regresses beyond the configured tolerance.
 *
 * Usage (called by the CI workflow):
 *   node scripts/check-latency-regression.js \
 *     --get-results   get-results.json \
 *     --post-results  post-results.json \
 *     --baseline      .github/load-test-baseline.json \
 *     --tolerance     10
 *
 * Environment variables (override CLI flags if set):
 *   LATENCY_TOLERANCE_PCT   Percentage tolerance over baseline (default: 10)
 *   BASELINE_FILE           Path to the baseline JSON file
 *   GET_RESULTS_FILE        Path to autocannon GET results JSON
 *   POST_RESULTS_FILE       Path to autocannon POST results JSON
 *
 * Exit codes:
 *   0  All endpoints within tolerance
 *   1  One or more endpoints exceeded baseline * (1 + tolerance/100)
 *   2  Usage / file-not-found error
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ─── Argument parsing ──────────────────────────────────────────────────────────
function parseArg(flag, defaultValue) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] !== undefined) {
    return process.argv[idx + 1];
  }
  return defaultValue;
}

const REPO_ROOT      = path.resolve(__dirname, "..");
const DEFAULT_BASELINE = path.join(REPO_ROOT, ".github", "load-test-baseline.json");

const GET_RESULTS_FILE  = process.env.GET_RESULTS_FILE  || parseArg("--get-results",  "get-results.json");
const POST_RESULTS_FILE = process.env.POST_RESULTS_FILE || parseArg("--post-results", "post-results.json");
const BASELINE_FILE     = process.env.BASELINE_FILE     || parseArg("--baseline",     DEFAULT_BASELINE);
const TOLERANCE_PCT     = parseFloat(
  process.env.LATENCY_TOLERANCE_PCT || parseArg("--tolerance", "10")
);

// ─── Core logic (exported for tests) ──────────────────────────────────────────

/**
 * Load and parse a JSON file. Returns parsed object or throws with a clear
 * message so callers can distinguish a file-not-found from a bad JSON error.
 *
 * @param {string} filePath
 * @returns {object}
 */
function loadJson(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw Object.assign(
      new Error(`File not found: ${abs}`),
      { code: "ENOENT" }
    );
  }
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

/**
 * Extract p99 latency (ms) from an autocannon JSON result object.
 *
 * @param {object} data  Parsed autocannon JSON
 * @returns {number}
 */
function extractP99(data) {
  if (
    !data ||
    typeof data.latency !== "object" ||
    data.latency === null ||
    typeof data.latency.p99 !== "number"
  ) {
    throw new Error(
      "Unexpected autocannon result shape — cannot find data.latency.p99"
    );
  }
  return data.latency.p99;
}

/**
 * Compare a single endpoint's current p99 against its baseline.
 *
 * @param {object} opts
 * @param {string} opts.name         Human-readable endpoint label
 * @param {number} opts.currentP99   p99 from this run (ms)
 * @param {number} opts.baselineP99  p99 from baseline file (ms)
 * @param {number} opts.tolerancePct Allowed % increase over baseline
 * @returns {{ passed: boolean, message: string, threshold: number }}
 */
function compareP99({ name, currentP99, baselineP99, tolerancePct }) {
  const threshold = baselineP99 * (1 + tolerancePct / 100);
  const passed    = currentP99 <= threshold;
  const delta     = currentP99 - baselineP99;
  const deltaPct  = baselineP99 > 0
    ? ((delta / baselineP99) * 100).toFixed(1)
    : "∞";

  const message = passed
    ? `✅  [${name}] p99 ${currentP99}ms — within tolerance ` +
      `(baseline ${baselineP99}ms + ${tolerancePct}% = ${threshold.toFixed(0)}ms, ` +
      `delta ${delta >= 0 ? "+" : ""}${deltaPct}%)`
    : `❌  [${name}] p99 ${currentP99}ms — REGRESSION ` +
      `(baseline ${baselineP99}ms + ${tolerancePct}% = ${threshold.toFixed(0)}ms, ` +
      `delta +${deltaPct}% — exceeded by ${(currentP99 - threshold).toFixed(0)}ms)`;

  return { passed, message, threshold };
}

/**
 * Run the full regression check across all configured endpoints.
 *
 * @param {object} opts
 * @param {object} opts.getResults        Parsed autocannon JSON for GET endpoint
 * @param {object} opts.postResults       Parsed autocannon JSON for POST endpoint
 * @param {object} opts.baseline          Parsed baseline JSON (our stored format)
 * @param {number} opts.tolerancePct      Tolerance percentage
 * @returns {{ passed: boolean, results: Array<object> }}
 */
function runRegressionCheck({ getResults, postResults, baseline, tolerancePct }) {
  const endpoints = [
    {
      name:        "GET /api/bounties",
      currentP99:  extractP99(getResults),
      baselineP99: baseline.baselines["GET /api/bounties"].p99Ms,
    },
    {
      name:        "POST /api/bounties",
      currentP99:  extractP99(postResults),
      baselineP99: baseline.baselines["POST /api/bounties"].p99Ms,
    },
  ];

  const results = endpoints.map(({ name, currentP99, baselineP99 }) =>
    compareP99({ name, currentP99, baselineP99, tolerancePct })
  );

  const passed = results.every((r) => r.passed);
  return { passed, results };
}

module.exports = { loadJson, extractP99, compareP99, runRegressionCheck };

// ─── CLI entry-point ───────────────────────────────────────────────────────────
if (require.main === module) {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🔍  Load-Test Latency Regression Gate");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Baseline file  : ${BASELINE_FILE}`);
  console.log(`  GET results    : ${GET_RESULTS_FILE}`);
  console.log(`  POST results   : ${POST_RESULTS_FILE}`);
  console.log(`  Tolerance      : ${TOLERANCE_PCT}%`);
  console.log("───────────────────────────────────────────────────────────\n");

  let getResults, postResults, baseline;

  try {
    getResults  = loadJson(GET_RESULTS_FILE);
    postResults = loadJson(POST_RESULTS_FILE);
    baseline    = loadJson(BASELINE_FILE);
  } catch (err) {
    console.error(`❌  Could not load required file: ${err.message}`);
    process.exit(2);
  }

  let checkResult;
  try {
    checkResult = runRegressionCheck({
      getResults,
      postResults,
      baseline,
      tolerancePct: TOLERANCE_PCT,
    });
  } catch (err) {
    console.error(`❌  Regression check failed: ${err.message}`);
    process.exit(2);
  }

  checkResult.results.forEach((r) => console.log(r.message));

  console.log("\n───────────────────────────────────────────────────────────");
  if (checkResult.passed) {
    console.log("  ✅  Regression gate PASSED — all endpoints within tolerance.");
    process.exit(0);
  } else {
    console.log("  ❌  Regression gate FAILED — latency regression detected.");
    console.log(
      "\n  To intentionally update the baseline (e.g. after a legitimate\n" +
      "  perf-affecting change), trigger the 'update-baseline' job via\n" +
      "  GitHub Actions → Weekly Load Test → Run workflow → check\n" +
      "  'Update baseline after this run'. Or run locally:\n" +
      "    node scripts/update-load-test-baseline.js"
    );
    process.exit(1);
  }
}
