# Design Document

## Overview

This document covers the technical design for two changes to the stellar-bounty-board repository:

1. **Dependabot audit** — a no-op verification pass confirming `.github/dependabot.yml` already satisfies all requirements.
2. **`resolve_dispute_by_timeout`** — a new permissionless Soroban contract entrypoint that refunds a disputed bounty to the maintainer once the arbitration window has elapsed without arbiter action, plus prerequisite structural fixes to `lib.rs` needed for the contract to compile cleanly.

## Architecture

The existing dispute flow is:

```
create_bounty → reserve_bounty → submit_bounty → dispute_bounty
                                                       ↓
                                              (arbiter calls)
                                              resolve_dispute(release=true)  → Released
                                              resolve_dispute(release=false) → Refunded
```

The new timeout escape hatch adds a second exit from `Disputed`:

```
dispute_bounty → (arbiter inaction, window elapses)
                       ↓
              resolve_dispute_by_timeout(bounty_id)  [anyone can call]
                       ↓
              BountyStatus::Refunded  +  full refund to maintainer
                       +  DisputeAutoResolved event
```

The two paths share the same entry precondition (`status == Disputed`) and the same effective-window calculation, but differ in authorization, default outcome, fee handling, and emitted event.

## Components and Interfaces

### Component 1 — `resolve_dispute_by_timeout` (new entrypoint)

**Location:** `contracts/src/lib.rs`, inside `impl StellarBountyBoardContract`

**Signature:**
```rust
pub fn resolve_dispute_by_timeout(env: Env, bounty_id: u64)
```

**Caller:** Anyone — no authorization required.

**Preconditions:**
- `bounty.status == BountyStatus::Disputed`
- `env.ledger().timestamp() >= bounty.dispute_raised_at + effective_window`

**Postconditions:**
- `bounty.status == BountyStatus::Refunded` (persisted to storage before any transfer)
- `bounty.amount` transferred to `bounty.maintainer` via `TokenClient::transfer`
- `DisputeAutoResolved` event emitted

**Effective window calculation** (mirrors `resolve_dispute`):
```rust
let effective_window: u64 = bounty.dispute_window_override.unwrap_or_else(|| {
    env.storage().persistent().get(&DataKey::DisputeWindow).unwrap_or(0)
});
```

---

### Component 2 — `ContractError::ResolutionWindowNotElapsed` (new error variant)

Added to the existing `ContractError` enum with discriminant `27`. Used exclusively by `resolve_dispute_by_timeout` when called before the window elapses.

---

### Component 3 — `DisputeAutoResolved` (new event struct)

Published under topics `("Bounty", "AutoRslv")` by `resolve_dispute_by_timeout`.

---

### Component 4 — Structural fixes to `lib.rs`

Four targeted fixes required before the new code compiles:

| Fix | Description |
|-----|-------------|
| Remove duplicate `initialize` stub | 3-arg partial stub before the real 5-arg function |
| Complete `DataKey` enum | Add all 12 missing variants currently referenced in the body |
| Remove bare `#[contracttype]` + orphaned `}` | Invalid syntax around line 172 |
| Remove duplicate `resolve_dispute` stub | `decision_u8: u8` variant conflicts with canonical `release: bool` version |

Also add missing event structs referenced throughout the file (`BountyResolved`, `BountyDisputed`, `BountyCanceled`, `BountyDeadlineExtended`, `DisputeAppealed`, `ArbiterRotationProposed`, `ArbiterRotationConfirmed`) so existing functions compile.

## Data Models

### New: `DisputeAutoResolved` event struct

```rust
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeAutoResolved {
    pub bounty_id: u64,
    pub maintainer: Address,
    pub amount: i128,   // full bounty amount, no fee deducted
}
```

### Modified: `ContractError` enum — new variant

```rust
ResolutionWindowNotElapsed = 27,
```

Added at the end of the existing enum. All existing discriminants are unchanged.

### Modified: `DataKey` enum — complete definition

```rust
#[contracttype]
enum DataKey {
    NextBountyId,
    Bounty(u64),
    FeeRecipient,
    Arbiter,
    DisputeWindow,
    MinBountyAmount,
    Paused,
    Admin,
    FeeStats,
    Config,
    PendingResolution(u64),
    AllowlistConfig,
    PendingArbiter,
    ArbiterRotationTimelock,
}
```

No on-chain storage migration needed — XDR discriminants for existing variants are unchanged; missing variants are simply made explicit in source.

### New constant: `MAX_BOUNTY_AMOUNT`

```rust
/// Maximum single bounty amount (10 billion stroops ≈ 1000 XLM).
pub const MAX_BOUNTY_AMOUNT: i128 = 10_000_000_000;
```

Required by `create_bounty` and `set_min_bounty_amount`. Add if not already present in the file.

## Error Handling

| Error | Trigger | Caller feedback |
|-------|---------|-----------------|
| `"bounty not disputed"` (panic string) | `bounty.status != Disputed` at entry | Caller tried to timeout a non-disputed bounty |
| `ContractError::ResolutionWindowNotElapsed` | `timestamp < dispute_raised_at + effective_window` | Caller invoked too early; must wait |
| `ContractError::BountyNotFound` | `bounty_id` does not exist in storage | Invalid ID |

The `panic_error` helper converts a `ContractError` into a named panic string (e.g. `"ResolutionWindowNotElapsed"`) that tests can match with `#[should_panic(expected = "...")]`.

All other errors (token transfer failure, storage failure) are handled by the Soroban SDK and surface as host-level panics — no additional wrapping is needed.

## Testing Strategy

Three integration tests are added to `contracts/src/test.rs`. All use `env.mock_all_auths()` to satisfy the `dispute_bounty` caller's `contributor.require_auth()` requirement, but the `resolve_dispute_by_timeout` call itself requires no auth.

### Test A — `test_resolve_dispute_by_timeout_too_early`

```
env.mock_all_auths()
setup_test()  →  mint 1000 to maintainer
create_bounty(500, deadline=now+1000, window=600)
reserve_bounty / submit_bounty / dispute_bounty
resolve_dispute_by_timeout(bounty_id)   ← called at T=0, window not elapsed
→ #[should_panic(expected = "ResolutionWindowNotElapsed")]
```

Verifies REQ-2.5: window check prevents early invocation.

### Test B — `test_resolve_dispute_by_timeout_success`

```
env.mock_all_auths()
setup_test()  →  mint 1000 to maintainer
create_bounty(500, deadline=now+2000, window=600)
reserve_bounty / submit_bounty
dispute_bounty  →  records dispute_raised_at = T
env.ledger().set_timestamp(T + 601)
resolve_dispute_by_timeout(bounty_id)
assert bounty.status == Refunded
assert token.balance(maintainer) == 1000
assert token.balance(contract) == 0
assert events contain DisputeAutoResolved { bounty_id, maintainer, amount: 500 }
```

Verifies REQ-2.3 (permissionless), REQ-2.4 (CEI / single execution), REQ-2.5 (window), REQ-2.6 (full refund, no fee), REQ-2.2 (event).

### Test C — `test_resolve_dispute_by_timeout_double_call`

```
(same setup and first resolution as Test B)
resolve_dispute_by_timeout(bounty_id)   ← second call
→ should_panic (status is Refunded, not Disputed)
```

Verifies REQ-2.4 / REQ-2.3.7: double-spend impossible after state transition.



## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Re-entrancy via token transfer | CEI: `write_bounty(Refunded)` called before `token.transfer` |
| Double-spend | Status check at entry; `Refunded` status prevents any second resolution |
| Griefing (caller triggers refund before arbiter can act) | Window check gives arbiter the full configured time before anyone can trigger timeout |
| Caller identity | Intentionally permissionless — no auth check by design (requirement) |
| Fee extraction on timeout | No fee: full `bounty.amount` returned; `accumulate_fee_stats` not called |
| `dispute_window_override = 0` | Validated at `create_bounty` against `MIN_DISPUTE_WINDOW_OVERRIDE (60s)`; global window of `0` means immediately elapsed — same behavior as `resolve_dispute` |

## Correctness Properties

### Property 1: Window enforcement
**Validates: Requirements REQ-2.5**

WHERE the bounty status is `Disputed` AND the ledger timestamp is less than `dispute_raised_at + effective_window`, WHEN `resolve_dispute_by_timeout` is called, THEN the contract SHALL panic with `ResolutionWindowNotElapsed`.

### Property 2: Successful refund
**Validates: Requirements REQ-2.3, REQ-2.6**

WHERE the bounty status is `Disputed` AND the ledger timestamp is greater than or equal to `dispute_raised_at + effective_window`, WHEN `resolve_dispute_by_timeout` is called, THEN the bounty status SHALL be `Refunded` and the maintainer SHALL receive exactly `bounty.amount` tokens.

### Property 3: Double-call prevention
**Validates: Requirements REQ-2.4**

WHERE `resolve_dispute_by_timeout` has successfully executed on bounty B, WHEN `resolve_dispute_by_timeout` is called again on bounty B, THEN the contract SHALL panic because the status is no longer `Disputed`.

### Property 4: Fund conservation
**Validates: Requirements REQ-2.6**

WHERE `resolve_dispute_by_timeout` executes successfully, THEN the sum of (maintainer token balance + contract token balance) SHALL equal the pre-call value — no tokens are created or destroyed.

### Property 5: No fee on timeout
**Validates: Requirements REQ-2.6**

WHERE `resolve_dispute_by_timeout` executes successfully, THEN `fee_stats.total_collected` and `fee_stats.bounty_count` SHALL remain unchanged, because timeout refunds are not fee-generating events.

## File Change Summary

| File | Change type | Description |
|------|------------|-------------|
| `.github/dependabot.yml` | Audit (no-op) | Confirm existing cargo entry is valid |
| `contracts/src/lib.rs` | Fix + Extend | Structural fixes, new event struct, new error variant, new entrypoint |
| `contracts/src/test.rs` | Extend | 3 new integration tests |
