# Stellar Bounty Board Contract

## Versioning

The contract exposes `CONTRACT_VERSION` from the `version` field in
`contracts/Cargo.toml`. Any pull request that changes `contracts/src/lib.rs`
must bump that package version so deployed contract behavior can be traced back
to a semver release.

The contract CI workflow diffs pull requests against `main` and fails when
`contracts/src/lib.rs` changes without a `contracts/Cargo.toml` version bump.
Maintainers may apply the `skip-version-check` label for trivial doc-only
changes that touch `lib.rs` but do not affect contract behavior.

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
- `refund_bounty(bounty_id, maintainer)` - returns escrow after the deadline has passed.
- `NewDeadlineMustBeGreaterThanCurrentDeadline` - extend_deadline requires a later deadline.
- `BountyNotFound` - referenced bounty does not exist.
