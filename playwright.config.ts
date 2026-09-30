import { defineConfig, devices } from '@playwright/test';

// ==============================================================================
// Playwright End-to-End Test Suite Configuration
// ==============================================================================
// Deliberate monorepo architectural configurations and framework distinctions
// are annotated below to prevent accidental regression during tooling upgrades.

export default defineConfig({
  testDir: 'playwright/tests',

  // Overall Test Timeout (Deliberately chosen):
  // Extended from Playwright's default 30s to 60s (60,000ms). Web3 transactions,
  // Soroban simulated invocations, and Freighter wallet popup emulation require
  // additional headroom compared to traditional REST/CRUD flows.
  timeout: 60_000,

  // Assertion Timeout (Standard Template Default):
  // 5s window for locator expectations (toBeVisible, toHaveText) before failing.
  expect: { timeout: 5000 },

  // Execution Parallelism (Deliberately chosen):
  // Default is true. Deliberately set to false to enforce sequential test execution.
  // E2E user stories reserve, release, and dispute shared bounty records in the backend
  // store. Running tests in parallel induces race conditions and contaminated escrow state.
  fullyParallel: false,

  use: {
    // Run headless in automated CI and local pre-commit runs
    headless: true,

    // Frontend Base Ingress URL (Deliberately chosen):
    // Maps to Vite development port 3000 by default or overridable via BASE_URL.
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',

    // Action Timeout (Deliberately chosen):
    // Playwright default has no timeout (0). Explicitly capped at 10s (10,000ms)
    // so stalled element actions (clicks, inputs) fail fast without waiting for the full 60s.
    actionTimeout: 10000,

    // Diagnostic Tracing (Standard Template Default):
    // Records trace artifacts exclusively on initial retry to balance debugging
    // visibility with storage constraints in GitHub Actions.
    trace: 'on-first-retry',
  },

  projects: [
    // Browser Matrix (Deliberately chosen):
    // Scoped exclusively to Chromium desktop in default test runs to conserve CI CPU/RAM
    // and accelerate pull request validation cycles.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
