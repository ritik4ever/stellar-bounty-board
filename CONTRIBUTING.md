## Summary

This PR implements a structured, self-contained `reserve_bounty` contract event so the Soroban event indexer worker can react to the reserve transition without polling whole contract storage.

Closes #1231.

## Problem

Before this change, `reserve_bounty` only emitted a lightweight `(Bounty, Reserv)` event with a `BountyReserved { bounty_id, contributor }` payload. That payload is not self-contained: an indexer that wants to update its view of the bounty on reserve still needs to follow up with a contract read to get the timestamp, status, token, repo/labels, deadline, and fee configuration. That follow-up cost scales with every reservation and makes the worker's "no follow-up contract read" contract promise untenable for the reserve transition.

## Solution

- Add `BountyReservedEvent` as a new `#[contracttype]` payload in `contracts/src/lib.rs`:
  - `bounty_id: u64`
  - `contributor: Address`
  - `reserved_at: u64`
  - `bounty_status_after_reserve: BountyStatus`
- Emit a structured `(Bounty, ReservEvt)` event from `reserve_bounty` using that payload.
- Keep the existing legacy `(Bounty, Reserv)` event so existing topic watchers and backward-compatible consumers are not broken.
- Add a contract test (`test_reserve_bounty_emits_structured_event`) that verifies:
  - The last event emitted by `reserve_bounty` is the structured `(Bounty, ReservEvt)` event.
  - The topics are `symbol_short!("Bounty")` and `symbol_short!("ReservEvt")`.
  - The structured payload deserializes to the expected `BountyReservedEvent`.
  - `reserved_at` is within the observed ledger timestamp window.
  - The legacy `(Bounty, Reserv)` event is still emitted immediately before the structured event.
  - The on-chain bounty status and contributor are correct after the call.
- Update the worker `normalizeEvent` and `EVENT_TYPES` tables in `backend/worker/indexer.js` so `(Bounty, ReservEvt)` maps to `type: "reserve"` and its payload fields are normalized without a follow-up read.
- Document the new topic/payload in `backend/worker/README.md`.

## Contract change details

- New struct: `BountyReservedEvent` in `contracts/src/lib.rs`.
- `reserve_bounty` now emits two events:
  - `(symbol_short!("Bounty"), symbol_short!("Reserv"))` with `BountyReserved { bounty_id, contributor }`
  - `(symbol_short!("Bounty"), symbol_short!("ReservEvt"))` with `BountyReservedEvent { bounty_id, contributor, reserved_at, bounty_status_after_reserve: BountyStatus::Reserved }`

This is intentionally additive and backward-compatible. The legacy event is unchanged; only a second structured event is added.

## Worker change details

- `backend/worker/indexer.js`
  - `EVENT_TYPES` now maps `ReservEvt` to `"reserve"`.
  - `normalizeEvent` normalizes the structured reserve payload when `type === "reserve"`, including `reservedAt` and `bountyStatusAfterReserve`. The comment already notes that the legacy `(Bounty, Reserv)` and structured `(Bounty, ReservEvt)` topics both map to `"reserve"` and that the structured payload is sufficient on its own.

## Documentation change details

- `backend/worker/README.md`
  - Added the `(Bounty, ReservEvt)` row to the topic/payload table.
  - Added a dedicated "Reserve event" section explaining the double-emit behavior and the worker's no-follow-up-read guarantee for the structured reserve event.
  - Fixed typos in the release-event section header.

## Test plan

### Contract tests (local contract-side CI)

Run from the `contracts/` tree:

- `cargo test`

This validates the new structured reserve event test and the existing contract suite.

### Worker typecheck

Run from the repository root:

- `npm --prefix backend run typecheck`

Note: the backend typecheck in this checkout currently fails on unrelated pre-existing app-level type errors in `src/app.ts`, `src/index.ts`, `src/graphql/resolvers.ts`, and `src/refundIdempotency.test.ts`. Those are not introduced by this PR and were ignored for the purposes of this change.

### Backend tests

Run from the repository root:

- `npm --prefix backend run test`

Note: many backend integration and unit tests in this checkout are already failing before this PR due to pre-existing environment/config/snapshot drift. The failures observed here are not caused by the worker change in this PR. The worker-specific indexer test (`test/workerIndexer.test.ts`) passes.

## Parity with the release transition

This PR mirrors the existing structured-event pattern already used by `release_bounty`:
- `(Bounty, Releas)` / `BountyReleased` legacy payload
- `(Bounty, RelEvent)` / `BountyReleasedEvent` structured payload

The reserve transition now follows the same design: a legacy lightweight event plus a structured self-contained event.

## Non-goals / out of scope

- No changes to `submit_bounty`, `refund_bounty`, `dispute_bounty`, or any other transition.
- No removal of the legacy `(Bounty, Reserv)` event.
- No backend API, database, or frontend changes.
- No migration or snapshot regeneration beyond what the new contract test naturally produces.

## Notes for reviewers

- The contract change is additive and backward-compatible at the event layer.
- The worker change is additive: existing `(Bounty, Reserv)` consumers still work, and the new `(Bounty, ReservEvt)` consumers can rely on the event payload alone.
- If a future indexer wants to drop the legacy `(Bounty, Reserv)` event, that would be a separate follow-up. This PR does not do that.
