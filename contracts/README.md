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

- `initialize(admin, fee_recipient, arbiter, dispute_window)` - one-time contract initialization that stores `Admin`, `FeeRecipient`, `Arbiter`, `DisputeWindow`, `MinBountyAmount` (`DEFAULT_MIN_BOUNTY_AMOUNT`), and `MinArbiterStake` without moving tokens or emitting events. Any subsequent call panics with `"already initialized"`, keeping the configured arbiter identity and initialized state immutable.
- `cancel_bounty(bounty_id, maintainer)` - cancels an **Open** bounty before reservation; returns full escrow (no fee), sets status to **Refunded**, and emits a `BountyCanceled` event. Only the original maintainer may call this. Terminal state is committed before the token transfer; if the transfer fails, the call aborts atomically leaving status Open and escrow intact.
- `submit_bounty(bounty_id, contributor)` - transitions a reserved bounty to the **Submitted** state and emits the `(Bounty, Submit)` event. Its `BountySubmitted` payload contains `bounty_id` and `contributor`, allowing indexer workers to process the state change without a follow-up contract read.
- `refund_bounty(bounty_id, maintainer)` - returns escrow after the deadline has passed and emits exactly one `(Bounty, Refund)` event. Its `BountyRefunded` payload, in field order, contains `bounty_id`, `maintainer`, `token`, full refunded `amount`, and `refunded_at`; indexers can reconstruct the committed refund without a follow-up contract read. The `Refunded` status is committed before the token call, and a failed transfer or unauthorized contributor call aborts atomically, leaving both balances and bounty status unchanged.
- `dispute_bounty(bounty_id, arbiter)` - transitions a submitted bounty to the **Disputed** state and emits the `(Bounty, Dispt)` event. Its `BountyDisputed` payload contains `bounty_id`, `contributor`, and `arbiter`, allowing indexer workers to process the state change without a follow-up contract read.
- `resolve_dispute(bounty_id, release)` - allows the arbiter to settle a disputed bounty by releasing funds to contributor (minus protocol fee) or refunding maintainer. Emits the single `(Bounty, Reslv)` event with `BountyResolved` containing `bounty_id`, `arbiter`, `release`, and the settled `amount` strictly after terminal state is committed. Failed transfers abort atomically leaving dispute state and escrow intact.
- `NewDeadlineMustBeGreaterThanCurrentDeadline` - extend_deadline requires a later deadline.
- `BountyNotFound` - referenced bounty does not exist.

## Storage Lifetime & Authority Enforcement

- **Storage TTL Refresh on Mutation:** For payout-related lifecycle operations (`release_bounty`, `refund_bounty`, `cancel_bounty`, `resolve_dispute`, `reassign_bounty`, `extend_deadline`, `finalize_resolution`), the contract refreshes persistent storage TTL for near-expiry bounties via `refresh_bounty_ttl` whenever remaining TTL falls below `BOUNTY_STORAGE_TTL_THRESHOLD` (1,000 ledgers), extending it to `BOUNTY_STORAGE_TTL_EXTEND_TO` (4,096 ledgers). Exact integer token units and fee floors (`floor(amount * protocol_fee_bps / 10_000)`) are preserved through settlement.
- **Authority First:** In all mutating entry points, caller authorization and role alignment (`maintainer.require_auth()` with maintainer matching, `contributor.require_auth()` with contributor matching, `arbiter.require_auth()` with registered arbiter matching) are verified strictly before any storage TTL refresh or state modification. Unauthorized callers receive typed mismatch or authorization errors (`MaintainerMismatch`, `ContributorMismatch`, `NotArbiter`), preventing unauthorized callers from redirecting funds or changing decisions.
- **Expired Entry Protection:** If a related persistent storage entry expires prior to a claim:
  - If `DataKey::Bounty` expired: calls abort with `BountyNotFound`.
  - If `DataKey::Arbiter` expired: dispute creation and dispute resolution abort with `ArbiterNotSet`.
  - If `DataKey::FeeRecipient` expired on fee-bearing bounties: payout calls abort with `FeeRecipientNotSet`.
  In all cases, escrow remains untouched and no unauthorized state change occurs.
- **Recovery & Regression Coverage:** Unresolved bounties near TTL expiry (`<= 1` ledger) recover cleanly when settled by an authorized caller (refreshing TTL to `>= BOUNTY_STORAGE_TTL_EXTEND_TO`, clearing escrow balances, and emitting lifecycle settlement events), while claims attempted after a related entry expires roll back atomically without partial payouts.

## Escrow Asset Accounting

The contract manages escrow funds with strict asset isolation and unit accounting across supported Stellar tokens:

- **Token decimal precision**: Token amounts are accounted for as integer units (`i128`), preserving the native precision of each asset (e.g. 7 decimals for XLM stroops, 6 decimals for USDC). The contract never mixes or normalizes token units across distinct asset contracts.
- **Maintainer authorization**: Creating a bounty and funding escrow requires explicit authentication from the maintainer (`maintainer.require_auth()`). Attempts without valid maintainer signatures fail with `Error(Auth, InvalidAction)`.
- **Escrow transfer integrity**: Funds are transferred atomically from the maintainer to the contract address upon bounty creation. If the token contract is invalid or the transfer fails, the transaction reverts with `EscrowTransferFailed` (#42) without creating state.
- **Overflow & Dust bounds**: Bounty amounts must be strictly positive and bounded by `MAX_BOUNTY_AMOUNT` (`1_000_000_000_000_000`), rejecting overflow attempts with `InvalidAmount` (#11). Amounts below `min_bounty_amount` are rejected with `AmountTooSmall` (#12).
- **Payout & Refund settlement**: On release, protocol fees (if configured) are routed to the fee recipient, with the net amount delivered to the contributor. On refund or cancellation, the full escrow amount returns to the maintainer. Escrow balances for unassociated bounties and distinct tokens remain isolated and untouched throughout all lifecycle transitions.
- **Role-based authority enforcement**: Every state-mutating entrypoint verifies explicit Soroban authorization (`require_auth()`) and role ownership (`maintainer`, `contributor`, `arbiter`, `admin`). Unauthorized callers cannot redirect escrow payouts/refunds or alter dispute resolution decisions. Unallowlisted tokens, non-contract addresses, and overflowed amounts are rejected before any bounty or escrow balance mutation.
