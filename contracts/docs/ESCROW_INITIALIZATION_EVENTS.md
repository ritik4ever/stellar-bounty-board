# Escrow Initialization Events (SBB-2026-404)

This document defines the event topic, payload fields, and deterministic
emission ordering for a committed `initialize` invocation on the
`StellarBountyBoardContract`. No live funds are used in tests; all verification
uses Soroban's in-memory test environment.

## Event ordering

A committed `initialize` invocation emits **exactly one** contract event, only
after all persistent storage writes (`Admin`, `FeeRecipient`, `Arbiter`,
`DisputeWindow`, `MinBountyAmount`, `MinArbiterStake`) have succeeded:

1. `("Escrow", "Init")` — `EscrowInitialized`

Initialization moves **zero** tokens and emits **zero** escrow funding or
balance events (`("Bounty", "Fund")` or `("Escrow", "Balance")`).

If `initialize` is called a second time (detected via `DataKey::FeeRecipient`),
Soroban rolls back the invocation atomically, panics with `"already
initialized"`, and emits **zero** contract events. The original arbiter
identity and initialized contract state remain immutable.

## Event schema

### 1. `("Escrow", "Init")` — `EscrowInitialized`

Fields, in deterministic order:

| Field | Type | Value on initialization |
|---|---|---|
| `admin` | `Address` | Initial contract administrator address |
| `fee_recipient` | `Address` | Protocol fee recipient address |
| `arbiter` | `Address` | Immutable initial arbiter identity persisted to `DataKey::Arbiter` |
| `dispute_window` | `u64` | Default dispute window in seconds |
| `min_bounty_amount` | `i128` | Default minimum bounty funding amount (`DEFAULT_MIN_BOUNTY_AMOUNT`) |
| `min_arbiter_stake` | `i128` | Default minimum arbiter bond (`DEFAULT_MIN_ARBITER_STAKE`) |
| `initialized_at` | `u64` | Ledger timestamp of the committed initialization |

## Consumer reconstruction

Consumers can reconstruct a committed escrow initialization **once** by:

- Processing only successfully committed contract events and deduplicating by
  `(transaction_hash, event_index)` (scoped to the contract ID).
- Reading the single `("Escrow", "Init")` event to populate the initial
  `admin`, `fee_recipient`, immutable `arbiter` identity, `dispute_window`,
  `min_bounty_amount`, `min_arbiter_stake`, and `initialized_at` without a
  follow-up contract read.
- Treating `("Escrow", "Init")` strictly as a configuration commitment, never as
  a token deposit or per-bounty escrow balance change.

## Run locally

```bash
cd contracts
cargo test --test escrow_initialize_events --test escrow_initialize
```
