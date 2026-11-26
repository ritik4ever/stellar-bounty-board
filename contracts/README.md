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
- `EscrowTransferFailed` - the token transfer from maintainer to contract escrow failed (#42).
- `NewDeadlineMustBeGreaterThanCurrentDeadline` - extend_deadline requires a later deadline.
- `BountyNotFound` - referenced bounty does not exist.

## Entry Points

- `initialize(admin, fee_recipient, arbiter, dispute_window)` - one-time contract initialization that stores `Admin`, `FeeRecipient`, `Arbiter`, `DisputeWindow`, `MinBountyAmount` (`DEFAULT_MIN_BOUNTY_AMOUNT`), and `MinArbiterStake` without moving tokens or emitting events. Any subsequent call panics with `"already initialized"`, keeping the configured arbiter identity and initialized state immutable.
- `create_bounty(maintainer, token, amount, repo, issue_number, title, deadline, protocol_fee_bps, dispute_window_override)` - funds and opens a new bounty in escrow. Requires explicit authorization from `maintainer` before any validation or transfer (rejecting signed contributor, arbiter, or outsider callers), enforces `amount >= min_bounty_amount` (`DEFAULT_MIN_BOUNTY_AMOUNT`) and allowlist membership for `token`, and reverts atomically with `EscrowTransferFailed` without storing bounty state or incrementing `NextBountyId` if the token transfer fails after validation.
- `cancel_bounty(bounty_id, maintainer)` - cancels an **Open** bounty before reservation; returns full escrow (no fee), sets status to **Refunded**, and emits a `BountyCanceled` event. Only the original maintainer may call this. Terminal state is committed before the token transfer; if the transfer fails, the call aborts atomically leaving status Open and escrow intact.
- `reserve_bounty(bounty_id, contributor)` - claims an **Open** bounty for `contributor` (`contributor.require_auth()`), transitioning status to **Reserved** and emitting `(Bounty, Reserv)`. Accepted strictly while `timestamp <= deadline` (including at the exact boundary `timestamp == deadline`), and rejected with `BountyExpired` past deadline. Rejects racing second contributors with `BountyAlreadyReserved` and non-open bounties with `BountyNotOpen`.
- `reassign_bounty(bounty_id, maintainer, new_contributor)` - transfers an active **Reserved** bounty to `new_contributor` and emits `(Bounty, Reassign)`. Requires `maintainer.require_auth()` and `bounty.maintainer == maintainer` (rejecting contributor, arbiter, or outsider callers with auth errors or `MaintainerMismatch`), and rejects expired or non-reserved bounties with `BountyMustBeReserved`.
- `submit_bounty(bounty_id, contributor)` - transitions a reserved bounty to the **Submitted** state and emits the `(Bounty, Submit)` event. Submission is accepted strictly while `timestamp <= deadline`, including at the exact boundary (`timestamp == deadline`). Submissions attempted when `timestamp > deadline` are rejected with `BountyExpired` (#22). Caller authorization is enforced (`contributor.require_auth()`), rejecting mismatched or unauthorized callers with `ContributorMismatch` (#26). Submission makes no token calls; failed submissions leave the stored reservation and escrow balances unchanged and emit no submit event. Successful submissions also move no tokens, preserving exact integer escrow units. Once submitted, subsequent ledger timestamp advances past the deadline do not expire the bounty. Its `BountySubmitted` payload contains `bounty_id` and `contributor`, allowing indexer workers to process the state change without a follow-up contract read.
- `refund_bounty(bounty_id, maintainer)` - returns escrow after the deadline has passed and emits exactly one `(Bounty, Refund)` event. Its `BountyRefunded` payload, in field order, contains `bounty_id`, `maintainer`, `token`, full refunded `amount`, and `refunded_at`; indexers can reconstruct the committed refund without a follow-up contract read. The `Refunded` status is committed before the token call, and a failed transfer or unauthorized contributor call aborts atomically, leaving both balances and bounty status unchanged.
- `dispute_bounty(bounty_id, arbiter)` - transitions a submitted bounty to the **Disputed** state and emits the `(Bounty, Dispt)` event. Its `BountyDisputed` payload contains `bounty_id`, `contributor`, and `arbiter`, allowing indexer workers to process the state change without a follow-up contract read.
- `resolve_dispute(bounty_id, release)` - allows the arbiter to settle a disputed bounty by releasing funds to contributor (minus protocol fee) or refunding maintainer. Strictly after terminal state is committed and token transfers succeed, emits `("Escrow", "Balance")` followed by `("Bounty", "Reslv")` with `BountyResolved` (`bounty_id`, `arbiter`, `release`, `amount`, `destination`, `token`, `net_amount`, `fee_amount`, `resolved_at`). Failed transfers abort atomically leaving dispute state and escrow intact with zero events emitted.

## Escrow Initialization Boundaries (SBB-2026-401)

Escrow initialization (`initialize`) establishes the contract's immutable governance identity and initial operational state under strict boundary guarantees:

- **Exact Ledger & Token Units Isolation:**
  - Initializing with a valid arbiter address executes cleanly without moving tokens. Token balances across admin, arbiter, fee recipient, and contract address remain strictly unchanged (contract balance = 0).
  - No lifecycle or escrow balance events are emitted during initialization, preventing spurious off-chain indexing.
- **Immutable Arbiter Identity:**
  - The valid arbiter address configured at genesis is persisted to `DataKey::Arbiter` and cannot be replaced or overwritten by subsequent `initialize` calls.
  - The configured arbiter holds exclusive authority over arbiter-gated entry points (`set_min_bounty_amount`, `pause`, `unpause`).
- **Initial Contract Parameters:**
  - Sets `Admin`, `FeeRecipient`, `Arbiter`, `DisputeWindow`, `MinBountyAmount` (`DEFAULT_MIN_BOUNTY_AMOUNT` = 100), and `MinArbiterStake` (`DEFAULT_MIN_ARBITER_STAKE`).
  - Contract paused state defaults to `false` (unpaused) and `NextBountyId` initializes to `0`.
- **One-time Initialization Atomicity:**
  - Re-initialization attempts are rejected atomically with `"already initialized"`, keeping all stored parameters and arbiter identity unchangeable.

## Bounty Escrow Funding Atomicity

Bounty escrow funding (`create_bounty`) enforces strict ordering and atomic rollback semantics to ensure escrow funds are never stranded or multiplied:

- **Validation Prior to Transfer:**
  All parameters and permissions are strictly verified before any token transfer is attempted:
  - Caller authority: verified via `maintainer.require_auth()`, rejecting signed contributor, arbiter, or outsider callers.
  - Circuit-breaker: verified via `get_paused_state`, rejecting creation while paused (`ContractIsPaused`).
  - Amount bounds: enforces strictly positive amount bounded by `MAX_BOUNTY_AMOUNT` (`InvalidAmount` #11) and `amount >= min_bounty_amount` (`AmountTooSmall` #12).
  - Deadline: must be strictly in the future (`DeadlineMustBeInTheFuture` #14).
  - Protocol fee: `protocol_fee_bps <= 10_000` (100%), and fee recipient configured in storage if fee > 0 (`FeeRecipientNotSet` #17).
  - Token allowlist: token must be present in allowlist if enabled (`TokenNotAllowed` #16).
  - Dispute window override: must fall between `MIN_DISPUTE_WINDOW_OVERRIDE` (60s) and `MAX_DISPUTE_WINDOW_OVERRIDE` (30 days) if specified.

- **Token Transfer Precedes Storage Mutation:**
  The token transfer from maintainer to contract address (`token_client.try_transfer(&maintainer, &contract_address, &amount)`) executes strictly before any storage keys (`DataKey::NextBountyId`, `DataKey::Bounty(id)`) are updated.

- **Atomic Failure Rollback:**
  If the token transfer fails for any reason (e.g., insufficient maintainer balance, non-functional or failing token contract):
  - The transaction aborts immediately with typed `ContractError::EscrowTransferFailed` (#42).
  - Storage writes are skipped: `DataKey::NextBountyId` is not incremented, and no bounty record is stored.
  - Existing bounties in storage and their locked escrow balances remain completely invariant and untouched.
  - Zero events (`BountyCreated`, `BountyCreatedEvent`) are published.
  - No funds are stranded in the contract (0 tokens moved to escrow) or deducted from the maintainer.

- **Sequential Retry Semantics:**
  Because `NextBountyId` is not incremented on failure, a subsequent retry (after the maintainer funds their account or resolves the token issue) is assigned the exact next sequential ID that was not consumed, ensuring deterministic numbering without gaps or skipped counters.

## Contract Reservation Authority (SBB-2026-413)

Reservation (`reserve_bounty`) and reassignment (`reassign_bounty`) enforce strict role authority, exact expiry boundary checks, and race resistance so unauthorized callers cannot redirect escrow funds or alter assignment decisions:

- **Contributor Authority on `reserve_bounty`**:
  - Requires explicit Soroban authorization from the reserving `contributor` (`contributor.require_auth()`).
  - Signed `maintainer`, `arbiter`, `admin`, or `outsider` callers attempting to sign on behalf of another contributor are rejected with an authorization error (`Error(Context, InvalidAction)`), leaving status `Open`, `contributor = None`, and escrow balances untouched.
- **Exact Expiry Ledger Boundary (`now <= deadline`)**:
  - At the exact expiry timestamp (`ledger.timestamp() == bounty.deadline`), an authorized `reserve_bounty` succeeds and transitions `Open -> Reserved` without moving escrow tokens.
  - Strictly past the deadline (`ledger.timestamp() > bounty.deadline`), `expire_if_needed` transitions `Open` or `Reserved` bounties to `Expired`; `reserve_bounty` fails with `BountyExpired` (#22) and `reassign_bounty` fails with `BountyMustBeReserved` (#19).
- **Racing Second Contributor & Redirect Protection**:
  - Once a bounty is `Reserved`, a second contributor racing to call `reserve_bounty` is rejected with `BountyAlreadyReserved` (#3), preserving the original `contributor` and escrow balance.
  - Reservation attempts against `Submitted`, `Disputed`, `Released`, or `Refunded` bounties fail with `BountyNotOpen` (#1), preventing post-reservation contributor hijacking.
- **Maintainer-Only Reassignment (`reassign_bounty`)**:
  - Only the bounty's registered `maintainer` (`maintainer.require_auth()` and `bounty.maintainer == maintainer`) may reassign an unexpired `Reserved` bounty; signed contributors, the arbiter, or outsiders fail with an authorization error or `MaintainerMismatch` (#25).

## Contract Submission Boundaries

The contract specifies and enforces strict boundaries for submitting reserved bounties:

- **Exact Ledger Timestamp Boundary (`now <= deadline`)**:
  - Authorized contributors can submit work up to and including the exact deadline timestamp (`ledger.timestamp() == bounty.deadline`). At `now == deadline`, `expire_if_needed` evaluates `now > deadline` as false; the bounty is not expired, status transitions from `Reserved` to `Submitted`, and `BountySubmitted` is emitted.
  - Submissions attempted when `ledger.timestamp() > bounty.deadline` (even by a single ledger second, `deadline + 1`) trigger `expire_if_needed`, which sets status to `Expired`, and the call fails with `ContractError::BountyExpired` (#13).
- **Escrow Balance Invariance**:
  - `submit_bounty` is an escrow-preserving lifecycle operation: zero tokens are transferred or moved between accounts on submission.
  - The contract escrow address retains 100% of the locked token units down to the exact integer unit (e.g., `1_234_567` stroops). Contributor and maintainer balances remain completely unaffected before and after submission.
- **Authority & Role Enforcement**:
  - Requires explicit Soroban authorization from the assigned contributor (`contributor.require_auth()`).
  - Outsiders, unauthenticated callers, or the maintainer attempting to submit on behalf of another contributor fail with `ContractError::ContributorMismatch` (#18) without mutating state or moving escrow tokens.
  - Non-reserved bounties (`Open`, already `Submitted`, `Disputed`, `Released`, `Refunded`) are rejected with `ContractError::BountyMustBeReserved` (#19).
- **Post-Submission Expiration Immunity**:
  - Once transitioned to `Submitted` at or before the deadline, subsequent advances of the ledger timestamp past the deadline (e.g. `deadline + 10_000`) do not expire the bounty. `expire_if_needed` only applies to `Open` and `Reserved` statuses, protecting legitimate submitted work from stale-deadline expiration during maintainer review or dispute windows.

## Arbiter Resolution Boundaries (SBB-2026-436)

Arbiter dispute settlement (`resolve_dispute`) enforces strict ledger, token-unit, destination, and finality boundaries:

- **Exact Ledger Window Boundary (`now >= dispute_raised_at + effective_dispute_window`)**:
  - Uses per-bounty `dispute_window_override` when set, otherwise falls back to global `DataKey::DisputeWindow`.
  - Resolution attempts at `now < dispute_raised_at + effective_dispute_window` (including `window - 1`) fail with `ContractError::DisputeWindowNotMet`, leaving status `Disputed`, escrow untouched, and emitting no `BountyResolved` event.
  - Resolution succeeds at the exact boundary timestamp `now == dispute_raised_at + effective_dispute_window` and any later timestamp.
- **Exact Payout Destinations & Integer Token Units**:
  - `release = true` (contributor destination): transitions status to `Released`, computes `fee = floor(amount * protocol_fee_bps / 10_000)`, transfers `amount - fee` to `contributor` and any positive `fee` to `FeeRecipient`, and drops contract escrow to `0` (`net + fee == amount`). When `fee == 0` (either `protocol_fee_bps == 0` or integer floor truncation), 100% of `amount` goes to `contributor`.
  - `release = false` (maintainer destination): transitions status to `Refunded` and returns 100% of `amount` to `maintainer` with zero protocol fee deducted, dropping contract escrow to `0`.
- **One Final Decision (Terminal Finality)**:
  - Only bounties in `Disputed` status may be resolved. Non-disputed statuses (`Open`, `Reserved`, `Submitted`) and already settled bounties (`Released`, `Refunded`) fail with `ContractError::BountyMustBeDisputed`.
  - Conflicting or duplicate resolution attempts after settlement cannot move funds, alter terminal status, or emit additional `(Bounty, Reslv)` events.
- **Strict Arbiter Authority**:
  - Requires explicit Soroban authorization from the configured `DataKey::Arbiter`. Maintainer, contributor, admin, outsider, or unsigned callers are rejected before any state mutation or token transfer.

## Arbiter Resolution Events (SBB-2026-439)

A committed `resolve_dispute` call publishes two contract events in a fixed, deterministic order so off-chain consumers can reconstruct the one final decision and exact destination once without a follow-up contract read:

1. `("Escrow", "Balance")` — `EscrowBalanceChanged` with `delta = -amount`, `remaining = 0`, and `status = Released | Refunded`.
2. `("Bounty", "Reslv")` — `BountyResolved` with fields in deterministic order:
   - `bounty_id: u64` — resolved bounty identifier.
   - `arbiter: Address` — arbiter address that authorized the decision.
   - `release: bool` — the one final decision (`true` -> `Released`, `false` -> `Refunded`).
   - `amount: i128` — full escrowed amount settled (`net_amount + fee_amount`).
   - `destination: Address` — exact recipient (`contributor` when `release == true`, `maintainer` when `release == false`).
   - `token: Address` — token contract address in which escrow was settled.
   - `net_amount: i128` — exact token units transferred to `destination`.
   - `fee_amount: i128` — exact protocol fee transferred to `FeeRecipient` (`0` on refund or zero-fee release).
   - `resolved_at: u64` — ledger timestamp of the committed resolution.

Both events are emitted only after terminal storage state (`Released` or `Refunded`) and token transfers succeed. Premature, unauthorized, failed, duplicate, or conflicting resolution calls abort atomically and emit zero resolution or escrow events.

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

## Escrow asset units

See [Escrow asset accounting boundaries](docs/ESCROW_ASSET_UNITS.md) for exact
base-unit accounting across tokens with different decimal precision and the
focused offline test command.
