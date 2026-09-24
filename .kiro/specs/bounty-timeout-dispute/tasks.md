# Implementation Plan: Bounty Timeout Dispute Resolution & Cargo Dependabot

## Overview

Five tasks in dependency order:
1. Audit Dependabot config (no-op confirmation)
2. Fix structural bugs in `lib.rs` (prerequisite for everything else)
3. Add new types (`ResolutionWindowNotElapsed` error + `DisputeAutoResolved` event)
4. Implement `resolve_dispute_by_timeout` entrypoint
5. Write and run integration tests

## Tasks

- [ ] 1. Audit `.github/dependabot.yml` for Cargo configuration — confirm `package-ecosystem: "cargo"` entry with `directory: "/contracts"`, `schedule.interval: "weekly"`, `groups` block covering `patch` and `minor` update types, and the npm entry for `/backend` and `/frontend` intact. File: `.github/dependabot.yml`

- [ ] 2. Fix structural issues in `contracts/src/lib.rs` — remove the orphaned 3-argument `initialize` stub; complete the `DataKey` enum with all 14 variants (`NextBountyId`, `Bounty(u64)`, `FeeRecipient`, `Arbiter`, `DisputeWindow`, `MinBountyAmount`, `Paused`, `Admin`, `FeeStats`, `Config`, `PendingResolution(u64)`, `AllowlistConfig`, `PendingArbiter`, `ArbiterRotationTimelock`); remove the bare `#[contracttype]` attribute with orphaned closing `}`; remove the duplicate `resolve_dispute(env, bounty_id, decision_u8: u8)` stub keeping only the canonical `release: bool` version; add `MAX_BOUNTY_AMOUNT` constant (`10_000_000_000i128`) if absent; add all missing event structs referenced by existing functions (`BountyResolved`, `BountyDisputed`, `BountyCanceled`, `BountyDeadlineExtended`, `DisputeAppealed`, `ArbiterRotationProposed`, `ArbiterRotationConfirmed`); confirm `ContractError` enum and `panic_error` helper are present; run `cargo build` inside `contracts/` and confirm zero errors. File: `contracts/src/lib.rs`

- [ ] 3. Add `ResolutionWindowNotElapsed` error variant and `DisputeAutoResolved` event struct — add `ResolutionWindowNotElapsed = 27` to the `ContractError` enum; add `#[contracttype] #[derive(Clone, Debug, PartialEq, Eq)] pub struct DisputeAutoResolved { pub bounty_id: u64, pub maintainer: Address, pub amount: i128 }`; run `cargo build` and confirm clean compilation. File: `contracts/src/lib.rs`

- [ ] 4. Implement `resolve_dispute_by_timeout` entrypoint — add `pub fn resolve_dispute_by_timeout(env: Env, bounty_id: u64)` after `resolve_dispute` inside `impl StellarBountyBoardContract`; panic with `"bounty not disputed"` if status is not `Disputed`; compute `effective_window` from `bounty.dispute_window_override` falling back to `DataKey::DisputeWindow`; `panic_error(ContractError::ResolutionWindowNotElapsed)` if `timestamp < dispute_raised_at + effective_window`; apply CEI: set `bounty.status = Refunded` and call `write_bounty` before calling `token_client.transfer` to maintainer; do NOT call `accumulate_fee_stats`; publish `DisputeAutoResolved` under topics `(symbol_short!("Bounty"), symbol_short!("AutoRslv"))`; run `cargo build` and confirm zero errors. File: `contracts/src/lib.rs`

- [ ] 5. Write integration tests for `resolve_dispute_by_timeout` — add `test_resolve_dispute_by_timeout_too_early` (annotated `#[should_panic(expected = "ResolutionWindowNotElapsed")]`): mock all auths, setup, mint 1000, create bounty 500/0-fee/deadline=now+2000, reserve, submit, dispute, immediately call `resolve_dispute_by_timeout`; add `test_resolve_dispute_by_timeout_success`: same setup with 600s window, dispute at T, advance ledger to T+601, call timeout resolution, assert `status == Refunded`, `token.balance(maintainer) == 1000`, `token.balance(contract) == 0`, and events contain `DisputeAutoResolved`; add `test_resolve_dispute_by_timeout_double_call`: run full success scenario then call `resolve_dispute_by_timeout` again and assert panic; run `cargo test` inside `contracts/` and confirm all three new tests plus all existing tests pass. File: `contracts/src/test.rs`

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3"] },
    { "wave": 3, "tasks": ["4"] },
    { "wave": 4, "tasks": ["5"] }
  ],
  "dependencies": {
    "1": [],
    "2": [],
    "3": ["2"],
    "4": ["3"],
    "5": ["4"]
  }
}
```

## Notes

- Task 2 is the highest-risk task. The file has multiple overlapping structural issues that interact — edit carefully in a single pass rather than incrementally to avoid partial-broken states.
- The `ContractError` enum and `panic_error` function may already exist in the middle section of the file that was not visible in truncated reads. Read the full file before making changes to avoid duplicating them.
- `cargo test` in Task 5 must pass the full existing test suite — not just the three new tests. Any regressions from structural fixes in Task 2 must be resolved before marking Task 5 complete.
- The `dispute_bounty` function in tests requires `contributor.require_auth()`, so tests use `env.mock_all_auths()`. The `resolve_dispute_by_timeout` call itself does not require any auth mock.
