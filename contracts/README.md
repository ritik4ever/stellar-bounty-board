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
- `BountyExpired` - disputes are only allowed up to and including the deadline.
- `ArbiterNotSet` - a dispute was raised before an arbiter was configured.
- `NotArbiter` - the `arbiter` argument of `dispute_bounty` is not the configured arbiter.
- `BountyNotFound` - referenced bounty does not exist.

## Entry Points

- `cancel_bounty(bounty_id, maintainer)` - cancels an **Open** bounty before reservation; returns full escrow (no fee), sets status to **Refunded**, and emits a `BountyCanceled` event. Only the original maintainer may call this.
- `refund_bounty(bounty_id, maintainer)` - returns escrow after the deadline has passed. Only the bounty's own `maintainer` may call it; every other address (contributor, arbiter, admin, stranger) is rejected with `MaintainerMismatch`, and a call that carries the maintainer address without that address's signature fails authorization.
- `dispute_bounty(bounty_id, arbiter)` - a **Submitted** bounty can be disputed by its contributor while `now <= deadline`; the `arbiter` argument must equal the configured arbiter. It sets status to **Disputed** and records `dispute_raised_at`.
- `NewDeadlineMustBeGreaterThanCurrentDeadline` - extend_deadline requires a later deadline.
- `BountyNotFound` - referenced bounty does not exist.

### `dispute_bounty` error precedence

`dispute_bounty` checks the deadline before the status:

1. `BountyNotFound` (no such id)
2. `BountyExpired` (`now > deadline`) — this includes a bounty that is already
   `Released` or `Refunded` but whose deadline has since passed.
3. `MissingContributor` (the bounty has no contributor, typically `Open`)
4. `BountyMustBeSubmitted` (any non-`Submitted` status at or before the deadline)
5. `ArbiterNotSet` (no arbiter configured)
6. `NotArbiter` (the supplied arbiter is not the configured one)

`now == deadline` is still inside the window: a dispute at exactly the deadline
succeeds.

## Events

Lifecycle events use the topic pair `("Bounty", "<action>")`.

| Topics                   | Payload                  | Emitted by                                             |
| ------------------------ | ------------------------ | ------------------------------------------------------ |
| `("Bounty", "Create")`   | `BountyCreated`          | `create_bounty`                                        |
| `("Bounty", "Reserv")`   | `BountyReserved`         | `reserve_bounty`                                       |
| `("Bounty", "Reassign")` | `BountyReassigned`       | `reassign_bounty`                                      |
| `("Bounty", "Submit")`   | `BountySubmitted`        | `submit_bounty`                                        |
| `("Bounty", "Releas")`   | `BountyReleased`         | `release_bounty`                                       |
| `("Bounty", "Refund")`   | `BountyRefunded`         | `refund_bounty`, `finalize_resolution` (refund ruling) |
| `("Bounty", "Cancel")`   | `BountyCanceled`         | `cancel_bounty`                                        |
| `("Bounty", "Extnd")`    | `BountyDeadlineExtended` | `extend_deadline`                                      |
| `("Bounty", "Dispt")`    | `BountyDisputed`         | `dispute_bounty`                                       |
| `("Bounty", "Reslv")`    | `BountyResolved`         | `resolve_dispute`                                      |
| `("Bounty", "Queried")`  | `BountyQueried`          | `get_bounty`                                           |

### `("Bounty", "Queried")`

`get_bounty` is the only read path that applies lazy expiration, so it publishes
the state it returns. The event was added so the indexer worker
(`backend/worker/`) can react to the `Open`/`Reserved` → `Expired` transition
without polling every bounty on a timer.

The payload carries the full mutable projection — id, maintainer, contributor,
token, amount, issue number, status, deadline, fee bps and dispute timestamp — so
a consumer can update its record without a follow-up contract read. Immutable,
unbounded metadata (`repo`, `title`) is intentionally not repeated: `repo` is
already carried by `BountyCreated`, and omitting both keeps the event size fixed
regardless of how long a bounty's text fields are.
