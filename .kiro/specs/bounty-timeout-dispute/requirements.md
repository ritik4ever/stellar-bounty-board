# Requirements Document

## Introduction

This spec covers two improvements to the stellar-bounty-board repository:

1. **Cargo Dependabot configuration** — verify and finalize automated Rust crate dependency updates via GitHub Dependabot, matching the existing npm update pattern (weekly schedule, patch+minor grouped).

2. **Timeout-based dispute resolution** — add a permissionless `resolve_dispute_by_timeout` entrypoint to the Soroban bounty escrow contract. When an arbiter fails to act within the configured dispute window, any caller can trigger this function to refund the bounty funds to the maintainer, unblocking permanently locked funds.

The contract currently has a full dispute lifecycle (`dispute_bounty` → `resolve_dispute`) but no escape hatch if the arbiter goes offline. This feature addresses that gap. It also requires resolving several pre-existing structural issues in `lib.rs` (duplicate function stubs, an incomplete `DataKey` enum, and a bare `#[contracttype]` attribute) before the new logic can compile.

## Glossary

- **Bounty**: An on-chain escrow record created by a maintainer, funded with a token amount, and associated with a GitHub issue.
- **Maintainer**: The address that created and funded the bounty.
- **Contributor**: The address that reserved and submitted work for the bounty.
- **Arbiter**: A trusted address (set at initialization) that resolves disputes between maintainer and contributor.
- **Dispute window**: The minimum time (in seconds) the arbiter must wait after a dispute is raised before resolving it. Configurable globally and per-bounty.
- **CEI pattern**: Checks-Effects-Interactions — a smart contract pattern where state is updated before external calls to prevent re-entrancy.
- **SAC**: Stellar Asset Contract — the token standard used to fund bounties.
- **Stroops**: The smallest unit of XLM (1 XLM = 10,000,000 stroops).

## Requirements

### Task 1: Cargo Dependabot Configuration

#### REQ-1.1

**User story:** As a repository maintainer, I want Dependabot to automatically open PRs for outdated Rust crates in `/contracts` so that dependency updates are not missed.

**Acceptance criteria:**
- The `.github/dependabot.yml` file contains a `package-ecosystem: "cargo"` entry with `directory: "/contracts"`.
- The schedule uses `interval: "weekly"`.
- A `groups` block consolidates `patch` and `minor` updates into a single PR per cycle.
- The existing `npm` entry covering `/backend` and `/frontend` is preserved unchanged.

> **Note:** Verification of the existing file shows all four criteria are already satisfied. This task requires an audit pass only.

---

### Task 2: Auto-Resolve Disputes by Timeout

#### REQ-2.1

**User story:** As a contract developer, I want a `ResolutionWindowNotElapsed` error variant so that callers can programmatically distinguish a too-early timeout call from other dispute errors.

**Acceptance criteria:**
- `ContractError` includes a `ResolutionWindowNotElapsed` variant.
- `resolve_dispute_by_timeout` panics with this error when called before the dispute window has elapsed.
- The variant name does not collide with the existing `DisputeWindowNotMet` variant used by the arbiter path.

---

#### REQ-2.2

**User story:** As an indexer or frontend developer, I want a distinct `DisputeAutoResolved` event so that I can differentiate timeout-triggered resolutions from arbiter-driven ones.

**Acceptance criteria:**
- A `#[contracttype]` struct `DisputeAutoResolved` exists with fields: `bounty_id: u64`, `maintainer: Address`, `amount: i128`.
- This struct is distinct from `BountyResolved` (the arbiter-driven event).
- The event is published by `resolve_dispute_by_timeout` under topics `("Bounty", "AutoRslv")`.

---

#### REQ-2.3

**User story:** As a maintainer or third-party keeper, I want to call `resolve_dispute_by_timeout` on any stalled disputed bounty without needing special authorization so that locked funds can always be recovered.

**Acceptance criteria:**
- The function signature is `pub fn resolve_dispute_by_timeout(env: Env, bounty_id: u64)`.
- No `require_auth()` call is present in the function body.
- Any address can invoke it successfully once the window has elapsed.

---

#### REQ-2.4

**User story:** As a smart contract engineer, I want the timeout resolution to follow the Checks-Effects-Interactions pattern so that funds cannot be double-spent via re-entrancy.

**Acceptance criteria:**
- The bounty `status` is set to `BountyStatus::Refunded` and persisted to storage before the token transfer is executed.
- A second call on the same bounty after resolution panics because the status is no longer `Disputed`.

---

#### REQ-2.5

**User story:** As a smart contract engineer, I want the timeout resolution to enforce the correct window check so that the function cannot be called too early.

**Acceptance criteria:**
- The effective window is computed as: `bounty.dispute_window_override` if `Some(_)`, else the global `DataKey::DisputeWindow`.
- If `env.ledger().timestamp() < bounty.dispute_raised_at + effective_window`, the function panics with `ResolutionWindowNotElapsed`.
- If the window has elapsed, the function proceeds to transfer and event emission.

---

#### REQ-2.6

**User story:** As a maintainer, I want a full refund (no protocol fee) when a dispute times out so that I am not penalized for arbiter inaction.

**Acceptance criteria:**
- The full `bounty.amount` is transferred to `bounty.maintainer`.
- No protocol fee is calculated or deducted.
- The `FeeStats` accumulator is NOT updated (this is not a fee-generating event).

---

#### REQ-2.7

**User story:** As a developer, I want the contract to compile cleanly before the new function is added so that pre-existing structural bugs do not mask new errors.

**Acceptance criteria:**
- The duplicate `pub fn initialize(...)` stub (3-arg version without `admin`) is removed.
- The `DataKey` enum includes all variants used in the contract body: `NextBountyId`, `Bounty(u64)`, `FeeRecipient`, `Arbiter`, `DisputeWindow`, `MinBountyAmount`, `Paused`, `Admin`, `FeeStats`, `Config`, `PendingResolution(u64)`, `AllowlistConfig`, `PendingArbiter`, `ArbiterRotationTimelock`.
- The bare `#[contracttype]` attribute with no associated type definition is removed.
- The duplicate `pub fn resolve_dispute(env: Env, bounty_id: u64, decision_u8: u8)` (the scheduling stub) is removed; only the canonical `resolve_dispute(env, bounty_id, release: bool)` implementation remains.

---

#### REQ-2.8

**User story:** As a QA engineer, I want integration tests covering the full dispute-to-timeout scenario so that correctness can be verified with every build.

**Acceptance criteria:**

**Test A — too early fails:**
- Create bounty → reserve → submit → dispute.
- Call `resolve_dispute_by_timeout` without advancing the ledger.
- The call panics with `"ResolutionWindowNotElapsed"`.

**Test B — success after window elapses:**
- Create bounty (500 stroops, 0% fee, global 600s window) → reserve → submit → dispute.
- Advance ledger timestamp to `dispute_raised_at + 600 + 1`.
- Call `resolve_dispute_by_timeout` (no auth required).
- Assert: `bounty.status == Refunded`.
- Assert: maintainer token balance restored to full minted amount.
- Assert: contract token balance is 0.
- Assert: a `DisputeAutoResolved` event was emitted.

**Test C — double-call prevented:**
- After Test B succeeds, call `resolve_dispute_by_timeout` again on the same bounty.
- Assert: the second call panics (bounty status is no longer `Disputed`).
