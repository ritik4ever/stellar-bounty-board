import { defineConfig, devices } from '@playwright/test';

// ==============================================================================
// Playwright End-to-End Test Suite Configuration
// ==============================================================================
// Architectural Overview & Matrix of Deviations from Playwright Defaults:
//
// 1. Test Timeout: 60_000ms (Playwright Default: 30_000ms)
//    - Deviation: Doubled timeout headroom.
//    - Reason: Soroban smart contract invocations and Freighter wallet mock state
//      require significantly longer than standard Web2 API roundtrips.
//
// 2. Parallelism: fullyParallel: false (Playwright Default: true)
//    - Deviation: Explicitly forced sequential execution.
//    - Reason: Bounty lifecycle tests mutate shared in-memory escrow state. Concurrent
//      execution causes race conditions and flaky test failures.
//
// 3. Action Timeout: actionTimeout: 10000ms (Playwright Default: 0 / infinite)
//    - Deviation: Enforced 10s action deadline.
//    - Reason: Stalled DOM interactions or unclickable elements fail fast after 10s
//      rather than blocking the runner until the 60s test deadline expires.
//
// 4. Browser Matrix: [chromium] (Playwright Default: chromium, firefox, webkit)
//    - Deviation: Scoped exclusively to Chromium desktop in default E2E runs.
//    - Reason: Reduces CI runner memory consumption and accelerates validation loops.
// ==============================================================================

export default defineConfig({
  testDir: 'playwright/tests',

  // Overall Test Timeout (Deliberately chosen: 60s vs 30s tool default):
  timeout: 60_000,

  // Assertion Timeout (Standard Template Default: 5s):
  expect: { timeout: 5000 },

  // Execution Parallelism (Deliberately chosen: false vs true tool default):
  fullyParallel: false,

  use: {
    // Run headless in automated CI and local pre-commit runs
    headless: true,

    // Frontend Base Ingress URL (Deliberate deviation: points to Vite dev server on port 3000):
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',

    // Action Timeout (Deliberately chosen: 10s vs 0 / no timeout tool default):
    actionTimeout: 10000,

    // Diagnostic Tracing (Standard Template Default: captures traces on initial retry):
    trace: 'on-first-retry',
  },

  projects: [
    // Browser Matrix (Deliberately chosen: single browser project vs multi-engine default):
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
