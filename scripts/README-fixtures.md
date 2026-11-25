# Local Test Data Seeding (SBB-2026-490)

## Overview

The local seed fixtures system provides deterministic, offline-only bounty test data for development and testing. These fixtures never use live funds, connect to RPC endpoints, or sign transactions.

## Quick Start

### Validate Fixtures (No Environment Setup Required)

```bash
node scripts/verify-fixtures.cjs
```

This validates fixture generation logic without file I/O.

### Run Full Test Suite

```bash
node --test scripts/local-seed-fixtures.test.cjs
```

Tests include configuration validation, reruns, partial JSON recovery, and conflict detection.

### Generate Fixtures

```bash
export LOCAL_SEED_NETWORK=testnet
export LOCAL_SEED_PASSPHRASE='Test SDF Network ; September 2015'
export LOCAL_SEED_MAINTAINER='GCFTHI4TAKQL5SXF47LFWXTEJJWNVRYW5KBIJ5BTPEXXVANCC3NJM5GK'
export LOCAL_SEED_CONTRIBUTOR='GAJ6XLOYGSLAY777ULNR6ASP6NKIVMKA43EIUDJNNMR26O5JGEH6R5T4'
export LOCAL_SEED_ARBITER='GDD3QRG4NE6M53UXQXRZTD27P7WFW3QICDXY3C4ZRRSAYCHGQ22AU5WD'

node scripts/local-seed-fixtures.cjs
```

Output is written to `.tmp/local-seed-fixtures/bounties.json` by default.

## Deterministic Fixtures

| ID | Status | Event History | Key Fields |
|---|---|---|---|
| BNT-9501 | open | created | Awaiting reservation |
| BNT-9502 | reserved | created → reserved | Has contributor, reservedAt |
| BNT-9503 | submitted | created → reserved → submitted | Has submissionUrl, submittedAt |
| BNT-9504 | disputed | created → reserved → submitted → disputed | Has disputeReason, disputedAt |
| BNT-9505 | refunded | created → reserved → submitted → disputed → refunded | Has refundedAt |
| BNT-9506 | released | created → reserved → submitted → released | Has releasedAt |

**Safety guarantees:**
- All fixtures use `tokenAddress: 'OFFLINE_FIXTURE_NO_TOKEN'`
- All fixtures have labels `['local-fixture', 'no-live-funds']`
- IDs, timestamps, and event histories are stable across runs
- No live transaction hashes included

## Files

- `local-seed-fixtures.cjs` - Main fixture generator with safety validation
- `local-seed-fixtures.test.cjs` - Comprehensive test suite (config, reruns, edge cases)
- `verify-fixtures.cjs` - Quick validation script for determinism checks

## Documentation

See [docs/local-test-data-seeding.md](../docs/local-test-data-seeding.md) for:
- Complete setup instructions
- Partial JSON recovery runbook
- Playwright E2E fixture tests
- Failure scenario inspection guide
