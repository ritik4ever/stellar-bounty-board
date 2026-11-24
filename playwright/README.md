# Bounty Lifecycle E2E Fixtures & Doubles (SBB-2026-482)

This directory contains validated fixtures, in-memory API and wallet doubles, and end-to-end specifications for Stellar Bounty Board's complete bounty lifecycle.

## Overview

The lifecycle test suite exercises the full path (`create` → `reserve` → `submit` → `release`) through the real frontend without moving live funds or requiring live Soroban RPC access.

### Components

- `playwright/support/lifecycle-fixtures.ts`:
  - Pure, testable validation of maintainer and contributor identities (Ed25519 StrKey CRC-16 checksums).
  - Testnet-only network validation, preventing accidental execution against live mainnet.
  - In-browser Freighter wallet double that signs payloads deterministically.
  - Supports wallet rejection simulation and recovery toggling (`setFreighterRejectSigning`).
  - Supports idempotent resets (`resetFreighterDouble`) for rerun safety.

- `playwright/support/lifecycle-api-double.ts`:
  - In-memory API and Soroban contract double intercepting `/api/**` routes.
  - Enforces strict transition assertions (open → reserved → submitted → released).
  - Supports simulating delayed contract confirmations or gateway timeouts (`failReleaseCount`).
  - Supports clean in-memory resets (`reset()`) across test runs.

---

## Rerun Safety & Error Recovery (SBB-2026-482)

### 1. Wallet Rejection & Recovery Path
When a maintainer declines a signature request in Freighter:
- The wallet double throws a deterministic rejection error.
- The UI handles the error gracefully and displays a clear toast notification: `"Signing was rejected in Freighter."`
- The bounty remains safely in the `Submitted` state without corrupted records or partial payout.
- The user can retry signing immediately (`setFreighterRejectSigning(page, false)`) to complete the release successfully.

### 2. Delayed Contract Confirmation & Recovery Path
When on-chain contract confirmation times out or encounters network delay:
- The API double simulates a transient failure (HTTP 504) without mutating bounty status.
- The UI alerts the maintainer and halts cleanly.
- The bounty remains in the `Submitted` state.
- Retrying the release operation resolves once confirmation succeeds, advancing the bounty to `Released`.

### 3. Repeated Runs
- Doubles and fixtures operate entirely in memory.
- Repeated executions do not depend on external state or live funds, ensuring 100% deterministic, flake-free runs.

---

## Running E2E Tests Locally

Run fixture validation:
```bash
npx playwright test playwright/tests/lifecycle-fixtures.spec.ts
```

Run full UI lifecycle specifications with Vite dev server running:
```bash
npx playwright test playwright/tests/bounty-lifecycle.spec.ts
```
