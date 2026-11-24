# Stellar Bounty Board Contract

## Error Codes

The contract uses named error codes for all invalid operations. These codes are emitted as panic messages in tests.

- `InvalidAmount` - amount must be positive.
- `DeadlineMustBeInTheFuture` - a bounty deadline must be later than the current ledger timestamp.
- `BountyNotOpen` - reserve is only allowed when a bounty is open; cancel is only allowed before reservation.
- `BountyMustBeReserved` - submit is only allowed when a bounty is reserved.
- `ContributorMismatch` - the submitting contributor must match the reserved contributor.
- `MaintainerMismatch` - the maintainer must match the bounty maintainer.
- `BountyMustBeSubmitted` - release is only allowed when a bounty has been submitted.
- `MissingContributor` - internal failure when a submitted bounty has no contributor.
- `BountyAlreadyFinalized` - refunds are not allowed for released or already refunded bounties.
- `BountyNotExpiredYet` - refunds are only allowed after the deadline.

## Dispute Resolution Authority

Disputes move escrowed funds, so every settlement path is authority-checked and
the paths are mutually exclusive:

- `dispute_bounty(bounty_id, arbiter)` requires the **contributor's** signature.
  The supplied arbiter must match the stored arbiter, but the arbiter does not
  sign to open a dispute.
- `resolve_dispute(bounty_id, release)` requires the **stored arbiter's**
  signature and is only allowed once the dispute window has elapsed. The arbiter
  chooses the destination: `release = true` pays the contributor (net of the
  protocol fee) and `release = false` refunds the maintainer in full.
- `propose_resolution(bounty_id, decision)` requires the **stored arbiter's**
  signature and only accepts a bounty in the `Disputed` state. It schedules a
  ruling without moving funds; the ruling becomes executable after the appeal
  window.
- `finalize_resolution(bounty_id)` is permissionless by design — it only executes
  the arbiter's scheduled ruling — but it re-checks that the bounty is still
  `Disputed`, so it cannot pay out a bounty settled by another path.
- `appeal(bounty_id)` requires the signature of the party that lost the scheduled
  ruling (the maintainer for a release, the contributor for a refund).
- `vote_resolve_dispute(bounty_id, arbiter, decision)` requires both committee
  membership and the **voting member's** signature; duplicate votes from the same
  member are rejected and the 2-of-3 quorum decides the payout.

Settling through `resolve_dispute`, a committee quorum, or `finalize_resolution`
clears any ruling scheduled through another path. The maintainer, contributor,
admin, and unrelated callers cannot settle or schedule a dispute, and rejected
invocations leave the bounty status and token balances unchanged.

Regression coverage lives in
[`tests/arbiter_resolution_auth.rs`](tests/arbiter_resolution_auth.rs) and
[`tests/arbiter_committee.rs`](tests/arbiter_committee.rs).

## Entry Points

- `cancel_bounty(bounty_id, maintainer)` - cancels an **Open** bounty before reservation; returns full escrow (no fee), sets status to **Refunded**, and emits a `BountyCanceled` event. Only the original maintainer may call this. Terminal state is committed before the token transfer; if the transfer fails, the call aborts atomically leaving status Open and escrow intact.
- `submit_bounty(bounty_id, contributor)` - transitions a reserved bounty to the **Submitted** state and emits the `(Bounty, Submit)` event. Its `BountySubmitted` payload contains `bounty_id` and `contributor`, allowing indexer workers to process the state change without a follow-up contract read.
- `refund_bounty(bounty_id, maintainer)` - returns escrow after the deadline has passed and emits the `(Bounty, Refund)` event. Its `BountyRefunded` payload contains `bounty_id`, `maintainer`, and the full refunded `amount`, so indexers do not need to read the bounty state to process the refund. Refund state is finalized before the token call; a failed transfer or unauthorized contributor call aborts atomically, leaving both balances and bounty status unchanged.
- `dispute_bounty(bounty_id, arbiter)` - transitions a submitted bounty to the **Disputed** state and emits the `(Bounty, Dispt)` event. Its `BountyDisputed` payload contains `bounty_id`, `contributor`, and `arbiter`, allowing indexer workers to process the state change without a follow-up contract read.
- `resolve_dispute(bounty_id, release)` - allows the arbiter to settle a disputed bounty by releasing funds to contributor (minus protocol fee) or refunding maintainer. Emits the single `(Bounty, Reslv)` event with `BountyResolved` containing `bounty_id`, `arbiter`, `release`, and the settled `amount` strictly after terminal state is committed. Failed transfers abort atomically leaving dispute state and escrow intact.
- `NewDeadlineMustBeGreaterThanCurrentDeadline` - extend_deadline requires a later deadline.
- `BountyNotFound` - referenced bounty does not exist.
