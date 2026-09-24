#!/usr/bin/env node
/**
 * update-load-test-baseline.js
 *
 * Overwrites .github/load-test-baseline.json with the p99 values from the
 * most recent autocannon run. Run this intentionally after a legitimate
 * performance-affecting change has been reviewed and merged.
 *
 * Usage (local):
 *   node scripts/update-load-test-baseline.js \
 *     --get-results   get-results.json \
 *     --post-results  post-results.json
 *
 * Usage (CI — called by the 'update-baseline' workflow_dispatch job):
 *   The workflow sets GET_RESULTS_FILE / POST_RESULTS_FILE / GITHUB_SHA /
 *   GITHUB_RUN_ID env vars automatically.
 *
 * Environment variables:
 *   GET_RESULTS_FILE    Path to autocannon GET results JSON  (default: get-results.json)
 *   POST_RESULTS_FILE   Path to autocannon POST results JSON (default: post-results.json)
 *   GITHUB_SHA          Commit SHA recorded in baseline metadata (optional)
 *   GITHUB_RUN_ID       Workflow run ID recorded in metadata  (optional)
 *   BASELINE_FILE       Destination path for the baseline JSON
 *                       (default: .github/load-test-baseline.json)
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const { loadJson, extractP99 } = require("./check-latency-regression");

// ─── Args ──────────────────────────────────────────────────────────────────────
function parseArg(flag, defaultValue) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] !== undefined) {
    return process.argv[idx + 1];
  }
  return defaultValue;
}

const REPO_ROOT         = path.resolve(__dirname, "..");
const DEFAULT_BASELINE  = path.join(REPO_ROOT, ".github", "load-test-baseline.json");

const GET_RESULTS_FILE  = process.env.GET_RESULTS_FILE  || parseArg("--get-results",  "get-results.json");
const POST_RESULTS_FILE = process.env.POST_RESULTS_FILE || parseArg("--post-results", "post-results.json");
const BASELINE_FILE     = process.env.BASELINE_FILE     || parseArg("--baseline",     DEFAULT_BASELINE);
const COMMIT_SHA        = process.env.GITHUB_SHA   || "local";
const RUN_ID            = process.env.GITHUB_RUN_ID || "local";

// ─── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  📝  Load-Test Baseline Updater");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  GET results  : ${GET_RESULTS_FILE}`);
  console.log(`  POST results : ${POST_RESULTS_FILE}`);
  console.log(`  Baseline out : ${BASELINE_FILE}`);
  console.log(`  Commit SHA   : ${COMMIT_SHA}`);
  console.log(`  Run ID       : ${RUN_ID}`);
  console.log("───────────────────────────────────────────────────────────\n");

  let getResults, postResults;

  try {
    getResults  = loadJson(GET_RESULTS_FILE);
    postResults = loadJson(POST_RESULTS_FILE);
  } catch (err) {
    console.error(`❌  Could not load results file: ${err.message}`);
    process.exit(1);
  }

  const getP99  = extractP99(getResults);
  const postP99 = extractP99(postResults);

  const baseline = {
    version: 1,
    description:
      "Accepted p99 latency baselines for the load-test regression gate. " +
      "Update intentionally via the 'update-baseline' workflow_dispatch job " +
      "or by running: node scripts/update-load-test-baseline.js",
    updatedAt:  new Date().toISOString(),
    commitSha:  COMMIT_SHA,
    runId:      RUN_ID,
    baselines: {
      "GET /api/bounties": {
        p99Ms: getP99,
        note: `Recorded from run ${RUN_ID} at commit ${COMMIT_SHA}`,
      },
      "POST /api/bounties": {
        p99Ms: postP99,
        note: `Recorded from run ${RUN_ID} at commit ${COMMIT_SHA}`,
      },
    },
  };

  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n", "utf8");

  console.log(`  GET /api/bounties  p99: ${getP99}ms`);
  console.log(`  POST /api/bounties p99: ${postP99}ms`);
  console.log(`\n✅  Baseline written to ${BASELINE_FILE}`);
  console.log(
    "\n  Remember to commit and push this file so the updated baseline\n" +
    "  is persisted in the repository."
  );
})();
