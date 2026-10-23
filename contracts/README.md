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

- `cancel_bounty(bounty_id, maintainer)` - cancels an **Open** bounty before reservation; returns full escrow (no fee), sets status to **Refunded**, and emits a `BountyCanceled` event. Only the original maintainer may call this.
- `submit_bounty(bounty_id, contributor)` - transitions a reserved bounty to the **Submitted** state and emits the `(Bounty, Submit)` event. Its `BountySubmitted` payload contains `bounty_id` and `contributor`, allowing indexer workers to process the state change without a follow-up contract read.
- `refund_bounty(bounty_id, maintainer)` - returns escrow after the deadline has passed and emits the `(Bounty, Refund)` event. Its `BountyRefunded` payload contains `bounty_id`, `maintainer`, and the full refunded `amount`, so indexers do not need to read the bounty state to process the refund.
- `dispute_bounty(bounty_id, arbiter)` - transitions a submitted bounty to the **Disputed** state and emits the `(Bounty, Dispt)` event. Its `BountyDisputed` payload contains `bounty_id`, `contributor`, and `arbiter`, allowing indexer workers to process the state change without a follow-up contract read.
- `NewDeadlineMustBeGreaterThanCurrentDeadline` - extend_deadline requires a later deadline.
- `BountyNotFound` - referenced bounty does not exist.

## Events

Contract events use a two-topic shape: `(symbol_short!("Bounty"), <action>)`
with a `#[contracttype]` payload.

| Topics | Emitted by | Payload |
| --- | --- | --- |
| `("Bounty", "Queried")` | `get_bounty` | `BountyQueried` |

`get_bounty` is the only read path that applies lazy expiration: an `Open` or
`Reserved` bounty past its deadline is returned as `Expired` without being
written back to storage. `BountyQueried` carries that post-expiration state
(bounty id, maintainer, contributor, token, amount, issue number, status,
deadline, protocol fee bps and dispute timestamp) so the indexer can observe
the transition from the event alone — no scan of every bounty and no follow-up
contract read. `repo` and `title` are omitted because they are immutable and
unbounded; `repo` is already carried by `BountyCreated`.

The worker consumes the event as `type: "queried"` (see `backend/worker/`).
