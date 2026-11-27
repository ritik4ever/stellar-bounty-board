# Contract Payout Events (SBB-2026-424)

This document defines the event topics, payload fields, and deterministic
emission ordering for a single committed payout of the exact escrow amount via
`release_bounty`. No live funds are used in tests; all verification uses mock
Soroban token contracts.

## Event ordering

A committed `release_bounty` invocation emits **exactly three** contract events,
in this strict order, only after `BountyStatus::Released`, all token transfers,
and `FeeStats` updates have succeeded:

1. `("Escrow", "Balance")` — `EscrowBalanceChanged`
2. `("Bounty", "Releas")` — `BountyReleased`
3. `("Bounty", "RelEvent")` — `BountyReleasedEvent`

If any validation, authorization, or token transfer fails, Soroban rolls back
the invocation atomically and **zero** contract events are emitted. A subsequent
call to `release_bounty` on an already-released bounty fails with
`ContractError::BountyMustBeSubmitted` and emits **zero** events.

## Event schemas and exact escrow conservation

Let `escrow_amount = bounty.amount`, `fee_amount = floor(escrow_amount * protocol_fee_bps / 10_000)`,
and `net_payout = escrow_amount - fee_amount`. The exact escrow amount is always
conserved:

```text
net_payout + fee_amount == escrow_amount
```

### 1. `("Escrow", "Balance")` — `EscrowBalanceChanged`

| Field | Type | Value on payout |
|---|---|---|
| `bounty_id` | `u64` | Released bounty ID |
| `token` | `Address` | Funded token contract address |
| `amount` | `i128` | `escrow_amount` (`delta.abs()`) |
| `delta` | `i128` | `-escrow_amount` |
| `previous` | `i128` | `escrow_amount` |
| `remaining` | `i128` | `0` |
| `status` | `BountyStatus` | `BountyStatus::Released` |

### 2. `("Bounty", "Releas")` — `BountyReleased`

| Field | Type | Value on payout |
|---|---|---|
| `bounty_id` | `u64` | Released bounty ID |
| `contributor` | `Address` | Net payout recipient |
| `amount` | `i128` | `net_payout` |
| `fee_amount` | `i128` | `fee_amount` (`0` when `protocol_fee_bps == 0`) |

### 3. `("Bounty", "RelEvent")` — `BountyReleasedEvent`

| Field | Type | Value on payout |
|---|---|---|
| `bounty_id` | `u64` | Released bounty ID |
| `maintainer` | `Address` | Maintainer who authorized the release |
| `contributor` | `Address` | Net payout recipient |
| `token` | `Address` | Funded token contract address |
| `amount` | `i128` | `net_payout` |
| `fee_amount` | `i128` | `fee_amount` |
| `protocol_fee_bps` | `u32` | Fee rate locked at bounty creation |
| `released_at` | `u64` | Ledger timestamp of the committed release |

## Consumer reconstruction

Consumers can reconstruct a committed payout **once** by:

- Processing only successfully committed contract events and deduplicating by
  `(transaction_hash, event_index)`.
- Treating `("Escrow", "Balance")` as the authoritative escrow debit
  (`-escrow_amount`, `remaining == 0`) and `("Bounty", "RelEvent")` as the
  self-contained payout record (`amount + fee_amount == escrow_amount`).
- Never summing `EscrowBalanceChanged.amount` with `BountyReleased.amount` or
  `BountyReleasedEvent.amount` as separate transfers.

## Run locally

```bash
cd contracts
cargo test --test payout_events
```
