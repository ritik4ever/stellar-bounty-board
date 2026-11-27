# Per-bounty escrow accounting events (SBB-2026-444 / #1913)

This document describes the new **contract** event, not a wallet's aggregate
Stellar account balance. An account's token holdings and the obligations of one
individual bounty are not interchangeable. No funds or transactions are created
by these examples; unit tests use mock Soroban asset contracts.

## Source of truth

The stored `Bounty` record identifies the **funded token address** in `token`
and its native integer `amount`. A bounty in `Open`, `Reserved`, `Submitted`,
`Expired`, or `Disputed` state still owes its full escrow amount; `Released`
and `Refunded` states owe zero. A reserve/submit/dispute-only action does not
change escrowed token units and publishes **no** escrow balance event.

The new event is published under topics `("Escrow", "Balance")` with a
`EscrowBalanceChanged` payload in this exact field order:

| Field | Type | Meaning |
|---|---|---|
| `bounty_id` | `u64` | Bounty key |
| `token` | `Address` | Exact funded token contract, **not** an assumed XLM ticker |
| `delta` | `i128` | Signed change in the token's own smallest units |
| `remaining` | `i128` | Per-bounty escrow obligation after this change |
| `status` | `BountyStatus` | Resulting stored bounty state |

A successful funding emits `{delta: +amount, remaining: amount, status: Open}`.
A successful payout (including its protocol fee), cancellation, refund, or
settlement emits `{delta: -amount, remaining: 0, status: Released|Refunded}`.
For example, a 101-unit payout with a 5-unit fee still decreases escrow by
**101** units; adding the fee to the event's debit would double-count it.
These units are whatever the funded token contract uses; do not hard-code
seven decimals for arbitrary Soroban-issued assets.

## Ordering, atomicity and deduplication

The accounting event is emitted **after** the final token transfer and bounty
storage transition have succeeded, and **before** the existing Bounty/Dispute
lifecycle event. Failed contract invocations revert storage changes, token
movements and contract events together. The original lifecycle event fields
and their relative ordering are preserved; do not independently count their
amount fields as additional escrow movements.

For indexers, process only successfully committed contract events and identify
an event by `(transaction_hash, event_index)` (scoped to the contract ID when
indexing several contracts). That unique event identity, not `bounty_id` alone,
prevents duplicated accounting on replay. Apply `delta` **once** per event,
partitioned by `(contract_id, bounty_id, token)`, and check that the resulting
amount equals `remaining`. Missing historical events require a fresh trusted
snapshot; they cannot be inferred from a later `Bounty` record with certainty.

The event reflects a **per-bounty liability**, not total token balance held by
the contract, which can contain deposits for many different bounties or assets.
It does not describe arbitrary transfers to the contract outside the bounty
flow. These rules apply only to transactions after this event version is deployed.

## Existing workflow

`create_bounty`, `release_bounty`, `refund_bounty`, `cancel_bounty`,
`resolve_dispute`, `finalize_resolution` and committee settlement emit a new
accounting event on successful escrow movements. Intermediate reserve, submit,
challenge, vote-without-quorum and proposal calls do not.

## Run locally

From repository root, with its existing Rust toolchain:

```bash
cd contracts
cargo test escrow_accounting_test
```

This suite mocks the token contract and does not use live funds. The PR must
also pass the existing contract test suite before merge.
