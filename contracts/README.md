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

## Entry Points

- `cancel_bounty(bounty_id, maintainer)` - cancels an **Open** bounty before reservation; returns full escrow (no fee), sets status to **Refunded**, and emits a `BountyCanceled` event. Only the original maintainer may call this. Terminal state is committed before the token transfer; if the transfer fails, the call aborts atomically leaving status Open and escrow intact.
- `submit_bounty(bounty_id, contributor)` - transitions a reserved bounty to the **Submitted** state and emits the `(Bounty, Submit)` event. Its `BountySubmitted` payload contains `bounty_id` and `contributor`, allowing indexer workers to process the state change without a follow-up contract read.
- `refund_bounty(bounty_id, maintainer)` - returns escrow after the deadline has passed and emits exactly one `(Bounty, Refund)` event. Its `BountyRefunded` payload, in field order, contains `bounty_id`, `maintainer`, `token`, full refunded `amount`, and `refunded_at`; indexers can reconstruct the committed refund without a follow-up contract read. The `Refunded` status is committed before the token call, and a failed transfer or unauthorized contributor call aborts atomically, leaving both balances and bounty status unchanged.
- `dispute_bounty(bounty_id, arbiter)` - transitions a submitted bounty to the **Disputed** state and emits the `(Bounty, Dispt)` event. Its `BountyDisputed` payload contains `bounty_id`, `contributor`, and `arbiter`, allowing indexer workers to process the state change without a follow-up contract read.
- `resolve_dispute(bounty_id, release)` - allows the arbiter to settle a disputed bounty by releasing funds to contributor (minus protocol fee) or refunding maintainer. Emits the single `(Bounty, Reslv)` event with `BountyResolved` containing `bounty_id`, `arbiter`, `release`, and the settled `amount` strictly after terminal state is committed. Failed transfers abort atomically leaving dispute state and escrow intact.
- `NewDeadlineMustBeGreaterThanCurrentDeadline` - extend_deadline requires a later deadline.
- `BountyNotFound` - referenced bounty does not exist.
