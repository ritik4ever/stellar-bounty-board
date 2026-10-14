/**
 * check-latency-regression.test.js
 *
 * Unit tests for the latency regression gate logic.
 * Runs with Node's built-in test runner (node --test) — no extra deps needed.
 *
 * Run:
 *   node --test scripts/check-latency-regression.test.js
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  extractP99,
  compareP99,
  runRegressionCheck,
} = require("./check-latency-regression");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal autocannon result shape with a given p99 */
function makeAutocannon(p99) {
  return {
    latency: { p50: p99 * 0.6, p99, max: p99 * 1.2 },
    requests: { total: 1000, sent: 1000, average: 33 },
    throughput: { average: 512000 },
    errors: 0,
    non2xx: 0,
    timeouts: 0,
  };
}

/** Minimal baseline object */
function makeBaseline(getP99, postP99) {
  return {
    version: 1,
    baselines: {
      "GET /api/bounties":  { p99Ms: getP99  },
      "POST /api/bounties": { p99Ms: postP99 },
    },
  };
}

// ─── extractP99 ───────────────────────────────────────────────────────────────

describe("extractP99", () => {
  it("returns p99 from a valid autocannon result", () => {
    assert.equal(extractP99(makeAutocannon(123)), 123);
  });

  it("throws when latency key is missing", () => {
    assert.throws(
      () => extractP99({ requests: {} }),
      /cannot find data\.latency\.p99/i
    );
  });

  it("throws when p99 is not a number", () => {
    assert.throws(
      () => extractP99({ latency: { p99: "fast" } }),
      /cannot find data\.latency\.p99/i
    );
  });
});

// ─── compareP99 ───────────────────────────────────────────────────────────────

describe("compareP99", () => {
  it("passes when current equals baseline", () => {
    const r = compareP99({
      name: "test",
      currentP99: 200,
      baselineP99: 200,
      tolerancePct: 10,
    });
    assert.equal(r.passed, true);
  });

  it("passes when current is below baseline", () => {
    const r = compareP99({
      name: "test",
      currentP99: 150,
      baselineP99: 200,
      tolerancePct: 10,
    });
    assert.equal(r.passed, true);
  });

  it("passes when current is exactly at the threshold boundary", () => {
    // baseline 200ms + 10% = 220ms — exactly 220 should pass
    const r = compareP99({
      name: "test",
      currentP99: 220,
      baselineP99: 200,
      tolerancePct: 10,
    });
    assert.equal(r.passed, true);
  });

  it("fails when current exceeds baseline + tolerance", () => {
    // baseline 200ms + 10% = 220ms — 221 should fail
    const r = compareP99({
      name: "test",
      currentP99: 221,
      baselineP99: 200,
      tolerancePct: 10,
    });
    assert.equal(r.passed, false);
  });

  it("fails with a deliberately regressed p99 (simulated 2× regression)", () => {
    // Simulate a slow deployment doubling latency
    const r = compareP99({
      name: "GET /api/bounties",
      currentP99: 1000,   // regressed to 1 second
      baselineP99: 300,   // baseline was 300ms
      tolerancePct: 10,   // threshold = 330ms
    });
    assert.equal(r.passed, false);
    assert.match(r.message, /REGRESSION/i);
  });

  it("includes threshold and delta in the message", () => {
    const r = compareP99({
      name: "endpoint",
      currentP99: 250,
      baselineP99: 200,
      tolerancePct: 10,
    });
    // threshold = 220, current = 250 — should fail
    assert.equal(r.passed, false);
    assert.ok(r.message.includes("220"), `Expected threshold 220 in: ${r.message}`);
  });

  it("respects a custom tolerance (15%)", () => {
    // baseline 200ms + 15% = 230ms — 229 should pass, 231 should fail
    const pass = compareP99({ name: "t", currentP99: 229, baselineP99: 200, tolerancePct: 15 });
    const fail = compareP99({ name: "t", currentP99: 231, baselineP99: 200, tolerancePct: 15 });
    assert.equal(pass.passed, true);
    assert.equal(fail.passed, false);
  });
});

// ─── runRegressionCheck ───────────────────────────────────────────────────────

describe("runRegressionCheck", () => {
  it("passes when both endpoints are within tolerance", () => {
    const result = runRegressionCheck({
      getResults:  makeAutocannon(180),   // baseline 200, tol 10% → threshold 220 ✓
      postResults: makeAutocannon(200),   // baseline 200, tol 10% → threshold 220 ✓
      baseline:    makeBaseline(200, 200),
      tolerancePct: 10,
    });
    assert.equal(result.passed, true);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((r) => r.passed));
  });

  it("fails when GET endpoint regresses", () => {
    const result = runRegressionCheck({
      getResults:  makeAutocannon(600),   // way over baseline of 200ms
      postResults: makeAutocannon(200),
      baseline:    makeBaseline(200, 200),
      tolerancePct: 10,
    });
    assert.equal(result.passed, false);
    assert.equal(result.results[0].passed, false);  // GET failed
    assert.equal(result.results[1].passed, true);   // POST ok
  });

  it("fails when POST endpoint regresses", () => {
    const result = runRegressionCheck({
      getResults:  makeAutocannon(200),
      postResults: makeAutocannon(800),   // deliberate regression
      baseline:    makeBaseline(200, 200),
      tolerancePct: 10,
    });
    assert.equal(result.passed, false);
    assert.equal(result.results[0].passed, true);   // GET ok
    assert.equal(result.results[1].passed, false);  // POST failed
  });

  it("fails when both endpoints regress", () => {
    const result = runRegressionCheck({
      getResults:  makeAutocannon(999),
      postResults: makeAutocannon(999),
      baseline:    makeBaseline(200, 200),
      tolerancePct: 10,
    });
    assert.equal(result.passed, false);
    assert.ok(result.results.every((r) => !r.passed));
  });

  it("scenario: p99 within tolerance — exit 0 equivalent (pass)", () => {
    // Acceptance criterion: run with p99 within tolerance → pass
    const result = runRegressionCheck({
      getResults:  makeAutocannon(210),  // baseline 200 + 10% = 220 — 210 < 220 ✓
      postResults: makeAutocannon(215),  // 215 < 220 ✓
      baseline:    makeBaseline(200, 200),
      tolerancePct: 10,
    });
    assert.equal(result.passed, true, "Expected gate to PASS but it failed");
  });

  it("scenario: deliberately regressed p99 via mock/fixture — exit 1 equivalent (fail)", () => {
    // Acceptance criterion: simulate regression via mock → gate must fail
    const result = runRegressionCheck({
      getResults:  makeAutocannon(350),  // baseline 200 + 10% = 220 — 350 >> 220 ✗
      postResults: makeAutocannon(180),
      baseline:    makeBaseline(200, 200),
      tolerancePct: 10,
    });
    assert.equal(result.passed, false, "Expected gate to FAIL but it passed");
    assert.match(result.results[0].message, /REGRESSION/i);
  });
});
