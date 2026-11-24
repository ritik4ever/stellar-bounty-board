# Stellar Bounty Board Contract

## Error Codes

The contract uses named error codes for all invalid operations. These codes are emitted as panic messages in tests.

- `InvalidAmount` - amount must be positive.
- `DeadlineMustBeInTheFuture` - a bounty deadline must be later than the current ledger timestamp.
- `NewDeadlineMustBeGreaterThanCurrentDeadline` - extend_deadline requires a later deadline.
- `BountyNotFound` - referenced bounty does not exist.
- `BountyNotOpen` - reserve is only allowed when a bounty is open; cancel is only allowed before reservation.
- `BountyMustBeReserved` - submit is only allowed when a bounty is reserved.
- `ContributorMismatch` - the submitting contributor must match the reserved contributor.
- `MaintainerMismatch` - the maintainer must match the bounty maintainer.
- `BountyMustBeSubmitted` - release is only allowed when a bounty has been submitted.
- `MissingContributor` - internal failure when a submitted bounty has no contributor.
- `BountyAlreadyFinalized` - refunds are not allowed for released or already refunded bounties.
- `BountyNotExpiredYet` - refunds are only allowed after the deadline.
- `BountyExpired` - dispute or submission attempted after the bounty deadline has elapsed.
- `BountyMustBeDisputed` - dispute resolution is only allowed when a bounty is in the **Disputed** state.
- `DisputeWindowNotMet` - dispute resolution cannot occur until the dispute window period has elapsed since the dispute was raised.
- `NotArbiter` - caller is not the registered arbiter.
- `ArbiterNotSet` - arbiter has not been configured for the contract.

## Entry Points

- `cancel_bounty(bounty_id, maintainer)` - cancels an **Open** bounty before reservation; returns full escrow (no fee), sets status to **Refunded**, and emits a `BountyCanceled` event. Only the original maintainer may call this.
- `submit_bounty(bounty_id, contributor)` - transitions a reserved bounty to the **Submitted** state and emits the `(Bounty, Submit)` event. Its `BountySubmitted` payload contains `bounty_id` and `contributor`, allowing indexer workers to process the state change without a follow-up contract read.
- `refund_bounty(bounty_id, maintainer)` - returns escrow after the deadline has passed and emits the `(Bounty, Refund)` event. Its `BountyRefunded` payload contains `bounty_id`, `maintainer`, and the full refunded `amount`, so indexers do not need to read the bounty state to process the refund.
- `dispute_bounty(bounty_id, arbiter)` - transitions a submitted bounty to the **Disputed** state and emits the `(Bounty, Dispt)` event. The caller must be the assigned contributor (requires contributor signature authority). Can only be called while the bounty is in the **Submitted** state and on or before the bounty deadline (`ledger.timestamp <= bounty.deadline`). Once release is committed, dispute is permanently disallowed. Its `BountyDisputed` payload contains `bounty_id`, `contributor`, and `arbiter`, allowing indexer workers to process the state change without a follow-up contract read.
- `resolve_dispute(bounty_id, release)` - resolves an active dispute and transitions the bounty to either **Released** (if `release` is true) or **Refunded** (if `release` is false), emitting the `(Bounty, DRes)` event. The caller must be the designated arbiter (requires arbiter signature authority). Can only be called when the bounty is in the **Disputed** state and after the dispute window has elapsed (`ledger.timestamp >= dispute_raised_at + effective_dispute_window`). Once resolved, post-release finality is enforced and subsequent disputes or resolutions are isolated and rejected.
