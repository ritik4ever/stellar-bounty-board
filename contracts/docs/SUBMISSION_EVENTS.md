# Contract Submission Events (SBB-2026-419)

This document defines the event topics, payload fields, deterministic emission
ordering, and unchanged-balance invariant for a single committed, authorized
submission via `submit_bounty`. No live funds are used in tests; all
verification uses mock Soroban token contracts.

## Event ordering

A committed `submit_bounty` invocation emits **exactly one** contract event,
strictly after `bounty.status` is persisted as `BountyStatus::Submitted`:

1. `("Bounty", "Submit")` — `BountySubmitted`

Because submission is a pure lifecycle transition (`Reserved -> Submitted`) and
does **not** move escrowed funds:

- **Zero** `("Escrow", "Balance")` (`EscrowBalanceChanged`) events are emitted.
- **Zero** token contract transfer events are emitted.
- Contract escrow, contributor, maintainer, and fee recipient token balances
  remain strictly unchanged.

If any validation or authorization check fails (`BountyNotFound`,
`BountyExpired`, `BountyMustBeReserved`, `MissingContributor`,
`ContributorMismatch`, or missing `contributor.require_auth()`), Soroban rolls
back the invocation atomically and **zero** contract events are emitted. A
duplicate `submit_bounty` call on an already-submitted bounty fails with
`ContractError::BountyMustBeReserved` and emits **zero** events.

## Event schema

### 1. `("Bounty", "Submit")` — `BountySubmitted`

| Field | Type | Value on submission |
|---|---|---|
| `bounty_id` | `u64` | Submitted bounty ID |
| `contributor` | `Address` | Authorized assigned contributor who submitted the work |

## Consumer reconstruction

Consumers can reconstruct a committed submission **once** by:

- Processing only successfully committed contract events and deduplicating by
  `(transaction_hash, event_index)`.
- Treating `("Bounty", "Submit")` as the single authoritative transition from
  `BountyStatus::Reserved` to `BountyStatus::Submitted` for `bounty_id`.
- Keeping the per-bounty escrow obligation unchanged on submission (no escrow
  debit or credit occurs until release, refund, cancellation, or dispute
  resolution).

## Run locally

```bash
cd contracts
cargo test --test submission_events
```
