# Offline local bounty fixtures: validation, reruns, and lifecycle tests

This example addresses the local seeding configuration, rerun recovery and deterministic fixture testing issues (#1954, #1956, #1957, #1958). It never calls Horizon, Stellar RPC, Freighter or any signing/transfer API. **These fixtures are not funded bounties.**

## Existing data model

The backend's file-based store uses a JSON array of bounty records and accepts an isolated path through `BOUNTY_STORE_PATH`. Each record has an `id`, `status`, timestamps, `version`, and an `events` history. The local fixture generator follows that shape without modifying `backend/data/bounties.json` or existing seeding utilities. The `tokenAddress` value is deliberately a non-deployed placeholder; do not use these records for live payout or chain interactions.

## Clean environment setup (Git Bash, from repository root)

No new packages are needed for the seeding utility and its Node tests.

```bash
export LOCAL_SEED_NETWORK=testnet
export LOCAL_SEED_PASSPHRASE='Test SDF Network ; September 2015'
export LOCAL_SEED_MAINTAINER='GCFTHI4TAKQL5SXF47LFWXTEJJWNVRYW5KBIJ5BTPEXXVANCC3NJM5GK'
export LOCAL_SEED_CONTRIBUTOR='GAJ6XLOYGSLAY777ULNR6ASP6NKIVMKA43EIUDJNNMR26O5JGEH6R5T4'
export LOCAL_SEED_ARBITER='GDD3QRG4NE6M53UXQXRZTD27P7WFW3QICDXY3C4ZRRSAYCHGQ22AU5WD'
node scripts/local-seed-fixtures.cjs
node --test scripts/local-seed-fixtures.test.cjs
# Quick validation without environment setup:
node scripts/verify-fixtures.cjs
```

The addresses above are reproducible **public** fixture identifiers derived from fixed text hashes. They do not correspond to included signing keys. No wallet should be funded for these tests. Alternatively, use three distinct valid public addresses you control only as *public identifiers*.

Supported networks are `testnet` and `standalone`; each requires its exact passphrase. A Mainnet configuration is rejected. `NODE_ENV=production` is rejected. The destination is restricted to `.tmp/local-seed-fixtures/*.json` (or a nested `.json` file under that directory). To select an isolated file:

```bash
export LOCAL_SEED_OUTPUT='.tmp/local-seed-fixtures/my-run/bounties.json'
node scripts/local-seed-fixtures.cjs
```

The generator will print how many records it added and how many it found unchanged. Review `.tmp/local-seed-fixtures/bounties.json`. Do **not** stage generated fixture output in a pull request. Avoid pointing a running backend at this file unless you have intentionally configured a test-only backend and disabled signing/transfer integrations. This tool itself never submits API requests or transactions.

## Deterministic records and valid status histories

| ID | Final status | Event history | Test validation |
|---|---|---|---|
| `BNT-9501` | `open` | created | No contributor, no timestamps beyond creation |
| `BNT-9502` | `reserved` | created → reserved | Has contributor, reservedAt timestamp set |
| `BNT-9503` | `submitted` | created → reserved → submitted | Has submittedAt, submissionUrl present |
| `BNT-9504` | `disputed` | created → reserved → submitted → disputed | Has disputedAt, disputeReason set |
| `BNT-9505` | `refunded` | created → reserved → submitted → disputed → refunded | Has refundedAt timestamp (simulated resolution) |
| `BNT-9506` | `released` | created → reserved → submitted → released | Has releasedAt timestamp (no live tx) |

**Validation guarantees (enforced by tests):**

- Identifiers, event timestamps, issue numbers and histories are stable across runs
- The generator never recreates or advances an existing fixture
- Will not silently change an existing record's status or events
- All fixtures use `tokenAddress: 'OFFLINE_FIXTURE_NO_TOKEN'` (never use for real transactions)
- All fixtures include labels `['local-fixture', 'no-live-funds']`
- Event timestamps are strictly monotonic within each record
- Version numbers match the event count exactly
- No transaction hashes (these are offline sample histories only)

## Partial JSON output: safe reruns and recovery

1. **Successful rerun:** existing fixtures match exactly. No rewrite or ID change occurs; output says `0 added`.
2. **Valid but incomplete JSON array:** the existing records stay unchanged and only the missing deterministic fixtures are appended. For example, two existing fixtures → four added.
3. **Truncated or malformed JSON:** the command prints `Seed JSON is incomplete or malformed` and exits non-zero. The original bytes are preserved. **Do not delete the file or rerun with forced overwrite.** Compare against your backup and restore a known-good valid array first.
4. **Conflicting state or altered status history:** it prints `Conflicting or advanced fixture ...` and stops. Inspect the record and event history; either use a new isolated output path, or manually reconcile from a trusted backup. The command does not roll back valid lifecycle changes automatically.
5. **Duplicated bounty IDs:** it rejects the document rather than producing ambiguous records.
6. **Concurrent run:** a `.lock` file blocks the second run. If a process crashed and left a stale lock, first verify no seeding process is running and inspect the JSON; then remove the stale lock manually before retrying.

Writes use a same-directory temporary file followed by rename; failures during parsing, validation or merge happen before rewriting the destination. There is no implicit auto-recovery from a corrupted document. Retain backups for any valuable local data. The generator is scoped to the `.tmp` directory rather than the backend's normal persistent store.

## Deterministic browser fixture tests (#1954)

`playwright/tests/local-bounty-lifecycle-fixtures.spec.ts` runs the **real frontend** with `page.route()` interception for `/api/*`; mocked responses simulate create → reserve → submit, reject a release when Freighter is disconnected, and hold a mocked release response pending until confirmation is supplied. No RPC endpoint, private key or live token is touched.

The Playwright configuration expects a frontend at `BASE_URL` (default `http://localhost:3000`); starting the existing frontend may require the repository's already configured dependencies. When your local frontend is running, execute:

```bash
npx playwright test playwright/tests/local-bounty-lifecycle-fixtures.spec.ts
```

The delayed-release case tests the **mock API transport**, not a real Freighter signature or a live on-chain confirmation. Full wallet-signing E2E verification remains out of scope without the appropriate contract mocks and frontend integration. Real workflow correctness should also be tested through the backend's existing lifecycle tests.

## Runbook: Inspecting and resolving lifecycle fixture outcomes (#1953)

This runbook guides operators and test authors through verifying deterministic state transitions without live funds, identifying observable failure signals, and resolving wallet or confirmation blockers.

### Repeatable state transitions without live funds

All lifecycle testing with local fixtures runs entirely in simulated offline environments. At each stage, the record version increments monotonically and a timestamped event is recorded:

1. **`open`:** Created with a valid title, description, reward amount, and token symbol. The bounty is available for reservation.
2. **`reserved`:** A contributor reserves the bounty via prompt dialog. The maintainer and contributor identifiers are validated public keys.
3. **`submitted`:** The contributor submits a pull request URL along with verification checklist checkboxes (`PR linked`, `PR description`, `CI checks pass`). The bounty enters the review phase.
4. **`released`:** The maintainer approves work and releases funds. This step requires wallet authentication and contract confirmation.

### Observable failure signals, inspection, and resolution

| Failure scenario | Observable signal | Root cause | Inspection method | Resolution |
|---|---|---|---|---|
| **Wallet rejection / Disconnection** | UI text: *"connect your Freighter wallet first"* appears; release action aborted; 0 calls to `/api/bounties/:id/release`. | Frontend checks `window.freighter` or connected wallet state before initiating escrow release. When absent or unapproved, UI halts submission. | 1. Check browser console for missing wallet warnings.<br>2. Inspect DevTools Network tab: confirm 0 POST requests were sent.<br>3. Verify bounty status remains `submitted` with unchanged `version`. | In manual/E2E testing, unlock the Freighter browser extension and approve site connection. In fixture tests, use mock wallet providers or verify client-side rejection behavior. |
| **Delayed contract confirmation** | Release button stays in loading/disabled state; bounty status remains `submitted`; pending HTTP POST request in Network tab. | Soroban RPC confirmation latency or simulated server gate (`releaseGate`) held open pending ledger inclusion. | 1. Inspect Network tab for long-running pending fetch to `/api/bounties/:id/release`.<br>2. In fixture double, check whether `fake.confirmRelease()` has been called.<br>3. In live testnet, inspect Soroban RPC `getTransaction` status (`NOT_FOUND` or `PENDING`). | In fixture tests, trigger `fake.confirmRelease()` to complete the simulated round-trip. On testnet, wait for Soroban consensus ledger close; do not resubmit redundant release transactions while confirmation is pending. |
| **Confirmation failure / Gateway timeout** | HTTP 504 / 500 returned to release fetch; error toast displayed in UI; bounty remains `submitted`. | RPC node timeout, transient network failure, or contract execution abort. | 1. Check Network tab for HTTP status 504/500.<br>2. Inspect `bounty.events`: verify no `released` event was appended.<br>3. Verify `bounty.version` did not increment. | Because state updates are atomic, failure leaves the bounty cleanly in `submitted` status without corrupting the store. Re-verify backend/RPC health and safely retry the release. |

### Diagnostic checklist for test authors

- **No live funds:** Never configure real mainnet or testnet seed phrases in E2E fixture environments.
- **State isolation:** Verify `fake.releaseCalls` counter to ensure release attempts are not silently dropped or doubled.
- **Event stream integrity:** Assert that `bounty.events.map(e => e.type)` matches the exact expected transition array (`['created', 'reserved', 'submitted', 'released']`).

## Verification and limitations

### Quick verification workflow

For rapid validation of fixture determinism without full environment setup:

```bash
# Verifies fixture generation logic (no file I/O)
node scripts/verify-fixtures.cjs

# Full test suite (includes file operations, reruns, edge cases)
node --test scripts/local-seed-fixtures.test.cjs
```

The `verify-fixtures.cjs` script validates:
- Exactly 6 fixtures with deterministic IDs (BNT-9501 through BNT-9506)
- All required statuses present (open, reserved, submitted, disputed, refunded, released)
- Event histories match status definitions exactly
- No live token addresses (all use `OFFLINE_FIXTURE_NO_TOKEN`)
- Safety labels present on all records (`local-fixture`, `no-live-funds`)
- Strictly monotonic event timestamps within each record
- Version numbers match event counts

### Limitations

- The standalone Node suite checks configuration fail-fast, invalid public keys and passphrases, deterministic statuses, duplicate IDs, reruns, partial valid output, malformed JSON, conflicting history and concurrent-run locks.
- The Playwright file uses the existing `@playwright/test` framework and depends on a running frontend for browser execution.
- Since these are local fixtures, passing tests does **not** prove that a contract was deployed, escrow was funded, a release was signed, or an on-chain payout succeeded.
- The backend JSON model may evolve; review fields against `backend/src/services/bountyStore.ts` when upgrading.
