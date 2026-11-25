#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::Client as TokenClient, Address,
    BytesN, Env, String, Vec,
};

mod escrow_accounting;

// ─── Contract Version ───────────────────────────────────────────────────
/// Semver string pulled from Cargo.toml at compile time.
pub const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Minimum allowed bounty amount to prevent dust bounties.
///
/// # Escrow funding boundaries (SBB-2026-406)
///
/// * **Denomination** — every bounty amount, including this minimum, is
///   expressed in the *smallest unit* of the accepted token (stroops for the
///   native SAC, or the token's own base unit for any other allowlisted SAC).
///   No decimal scaling is applied anywhere in the contract: the value passed
///   to `create_bounty` is exactly the value escrowed and later paid out.
/// * **Minimum supported amount** — this constant is the default floor. The
///   arbiter may raise or lower it via `set_min_bounty_amount`, and the
///   effective floor is what `get_min_bounty_amount` returns.
/// * **Below-minimum rejection** — `create_bounty` rejects any `amount` below
///   the effective floor with [`ContractError::AmountTooSmall`], before any
///   token movement or storage write.
/// * **Single ID, single balance** — a successful funding allocates exactly one
///   new bounty ID and leaves exactly one escrow balance for that ID, equal to
///   the funded `amount`.
///
/// Default: 100 stroops (0.00001 XLM).
pub const DEFAULT_MIN_BOUNTY_AMOUNT: i128 = 100;

/// Minimum allowed per-bounty dispute window override (1 minute in seconds).
pub const MIN_DISPUTE_WINDOW_OVERRIDE: u64 = 60;

/// Maximum allowed per-bounty dispute window override (30 days in seconds).
pub const MAX_DISPUTE_WINDOW_OVERRIDE: u64 = 2_592_000;

/// Keep bounty records alive while a state-changing operation is using them.
/// These values are deliberately below the network maximum so a mutation can
/// refresh an entry without making its rent horizon unbounded.
pub const BOUNTY_STORAGE_TTL_THRESHOLD: u32 = 1_000;
pub const BOUNTY_STORAGE_TTL_EXTEND_TO: u32 = 4_096;

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BountyStatus {
    Open,
    Reserved,
    Submitted,
    Released,
    Refunded,
    Expired,
    Disputed,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bounty {
    pub maintainer: Address,
    pub contributor: Option<Address>,
    pub token: Address,
    pub amount: i128,
    pub repo: String,
    pub issue_number: u32,
    pub title: String,
    pub deadline: u64,
    pub status: BountyStatus,
    pub protocol_fee_bps: u32, // stored per-bounty so the fee is locked in at creation time
    pub dispute_raised_at: u64,
    pub dispute_window_override: Option<u64>,
}

/// Token allowlist configuration — restricts which SAC tokens can fund bounties
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AllowlistConfig {
    pub enabled: bool,
    pub allowed_tokens: Vec<Address>,
}

/// Cumulative fee statistics updated on every payout release.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeeStats {
    /// Running total of all protocol fees collected (in token stroops).
    pub total_collected: i128,
    /// Number of bounties that have been released (fee-generating events).
    pub bounty_count: u64,
}

#[contracttype]
enum DataKey {
    Admin,
    FeeRecipient,
    Arbiter,
    DisputeWindow,
    MinBountyAmount,
    Paused,
    FeeStats,
    AllowlistConfig,
    PendingArbiter,
    ArbiterRotationTimelock,
    Config,
    NextBountyId,
    Bounty(u64),
    PendingResolution(u64),
    // ── Appended after the variants above (never reorder or remove those:
    //    existing instances already store these discriminants).
    /// Minimum bond an arbitration candidate must hold to take office.
    MinArbiterStake,
    /// Recorded bond held for an address, keyed by that address.
    ArbiterStake(Address),
    /// The WASM hash this contract was last upgraded to, if ever.
    WasmHash,
    /// Multi-arbiter committee membership for dispute resolution.
    ArbiterCommittee,
    /// Recorded votes cast by committee members per disputed bounty.
    DisputeVotes(u64),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyCreated {
    pub bounty_id: u64,
    pub maintainer: Address,
    pub token: Address,
    pub amount: i128,
    pub repo: String,
    pub issue_number: u32,
    pub protocol_fee_bps: u32, // included in event for indexers
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyCreatedEvent {
    pub bounty_id: u64,
    pub maintainer: Address,
    pub token: Address,
    pub amount: i128,
    pub repo: String,
    pub issue_number: u32,
    pub title: String,
    pub deadline: u64,
    pub protocol_fee_bps: u32,
    pub dispute_window_override: Option<u64>,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyReserved {
    pub bounty_id: u64,
    pub contributor: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyReassigned {
    pub bounty_id: u64,
    pub old_contributor: Address,
    pub new_contributor: Address,
}

/// Payload for the `(Bounty, Submit)` event emitted when a bounty is submitted by a contributor.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountySubmitted {
    pub bounty_id: u64,
    pub contributor: Address,
}

/// Payload for the `(Bounty, Releas)` event emitted by `release_bounty`.
///
/// Emitted strictly after `("Escrow", "Balance")` and immediately before
/// `("Bounty", "RelEvent")` on a committed payout of the exact escrow amount.
///
/// Fields, in deterministic order:
/// - `bounty_id`: which bounty was released.
/// - `contributor`: the recipient of the net payout.
/// - `amount`: net payout transferred to `contributor` after deducting protocol fee.
/// - `fee_amount`: protocol fee transferred to `FeeRecipient` (`0` when fee is zero).
///
/// Conservation invariant: `amount + fee_amount == escrowed_amount`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyReleased {
    pub bounty_id: u64,
    pub contributor: Address,
    pub amount: i128,     // net payout after fee
    pub fee_amount: i128, // how much went to fee recipient
}

/// Payload for the `(Bounty, RelEvent)` event emitted by `release_bounty`.
///
/// This event is scoped specifically to the `release_bounty` transition so
/// that off-chain consumers can reconstruct the committed payout once without
/// a follow-up contract read. It is emitted third and last in the payout event
/// sequence, strictly after `("Escrow", "Balance")` and `("Bounty", "Releas")`.
///
/// Fields, in deterministic order:
/// - `bounty_id`: which bounty was released.
/// - `maintainer`: who authorized the release.
/// - `contributor`: who received the net payout.
/// - `token`: the token contract address the bounty was escrowed in.
/// - `amount`: the net payout to the contributor (after fee).
/// - `fee_amount`: the protocol fee transferred to the fee recipient.
/// - `protocol_fee_bps`: the fee rate locked in at creation time.
/// - `released_at`: the ledger timestamp at which the release occurred.
///
/// Conservation invariant: `amount + fee_amount == escrowed_amount`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyReleasedEvent {
    pub bounty_id: u64,
    pub maintainer: Address,
    pub contributor: Address,
    pub token: Address,
    pub amount: i128,
    pub fee_amount: i128,
    pub protocol_fee_bps: u32,
    pub released_at: u64,
}

/// Payload for the `(Bounty, Refund)` event emitted when escrow is refunded.
///
/// Fields, in deterministic order:
/// - `bounty_id`: the refund being emitted.
/// - `maintainer`: the rightful payee that received the escrow.
/// - `token`: the token contract used for the refund.
/// - `amount`: the full escrow amount refunded.
/// - `refunded_at`: the ledger timestamp of the committed refund.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyRefunded {
    pub bounty_id: u64,
    pub maintainer: Address,
    pub token: Address,
    pub amount: i128,
    pub refunded_at: u64,
}

/// Payload for the `(Bounty, Fund)` event emitted when escrow is funded.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyFunded {
    pub bounty_id: u64,
    pub token: Address,
    pub amount: i128,
    pub escrow_balance: i128,
    pub status: BountyStatus,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub appeal_window: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DisputeDecision {
    Release,
    Refund,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingResolution {
    pub decision: DisputeDecision,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeResolutionScheduled {
    pub bounty_id: u64,
    pub decision: DisputeDecision,
    pub resolve_at: u64,
}

/// Emitted when the contract admin (arbiter) pauses the circuit-breaker.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContractPaused {
    pub admin: Address,
}

/// Emitted when the contract admin (arbiter) unpauses the circuit-breaker.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContractUnpaused {
    pub admin: Address,
}

/// Emitted when a bounty is canceled by its maintainer before reservation.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyCanceled {
    pub bounty_id: u64,
    pub maintainer: Address,
    pub amount: i128,
}

/// Emitted when a bounty's deadline is extended.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyDeadlineExtended {
    pub bounty_id: u64,
    pub new_deadline: u64,
}

/// Emitted when a contributor raises a dispute on a submitted bounty.
///
/// This is the single event emitted by `dispute_bounty`, and it is emitted
/// only after the `Disputed` state has been committed to storage. Consumers
/// can therefore treat its presence as proof that the bounty is disputed and
/// that escrow funds are still intact (a dispute moves no tokens).
///
/// Fields, in deterministic order:
/// - `bounty_id`: which bounty was disputed.
/// - `contributor`: the contributor that raised the dispute.
/// - `arbiter`: the arbiter that will rule on it.
/// - `dispute_raised_at`: ledger timestamp recorded in `bounty.dispute_raised_at`;
///   the dispute window for resolution starts here.
/// - `deadline`: the bounty deadline at the time of the dispute. The dispute
///   was raised at or before this timestamp (the last eligible ledger is
///   exactly `deadline`).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyDisputed {
    pub bounty_id: u64,
    pub contributor: Address,
    pub arbiter: Address,
    pub dispute_raised_at: u64,
    pub deadline: u64,
}

/// Emitted when an arbiter resolves a dispute (release or refund).
///
/// This is the single event emitted by `resolve_dispute`, emitted only after the
/// terminal state (`Released` or `Refunded`) has been committed to storage.
/// Consumers can reconstruct the settled state and escrow distribution from this
/// event without requiring a follow-up contract read.
///
/// Fields, in deterministic order:
/// - `bounty_id`: which bounty was resolved.
/// - `arbiter`: the arbiter address that authorized the resolution.
/// - `release`: the decision (`true` for release to contributor, `false` for refund to maintainer).
/// - `amount`: the full escrow amount settled.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyResolved {
    pub bounty_id: u64,
    pub arbiter: Address,
    pub release: bool,
    pub amount: i128,
}

/// Emitted when the losing party of a dispute files an appeal.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeAppealed {
    pub bounty_id: u64,
}

/// Emitted when the admin proposes a new arbiter address (pending timelock).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbiterRotationProposed {
    pub new_arbiter: Address,
    pub unlock_time: u64,
}

/// Emitted when the admin confirms an arbiter rotation after the timelock elapses.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbiterRotationConfirmed {
    pub old_arbiter: Address,
    pub new_arbiter: Address,
}

/// A bond recorded against an address, and the token it was paid in.
///
/// The amount is the balance still held by the contract for that address; a
/// slash reduces it and moves the tokens out to the treasury.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbiterStake {
    pub token: Address,
    pub amount: i128,
}

/// Emitted when an address bonds tokens toward arbitration.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbiterBonded {
    pub arbiter: Address,
    pub token: Address,
    /// Amount added by this call.
    pub amount: i128,
    /// Recorded bond after this call.
    pub total: i128,
}

/// Emitted when part of a bond is forfeited to the treasury.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbiterSlashed {
    pub arbiter: Address,
    pub token: Address,
    /// Amount forfeited by this call.
    pub amount: i128,
    /// Recorded bond still held after the slash.
    pub remaining: i128,
    pub treasury: Address,
    pub reason: String,
}

/// ─── Upgrade Event ──────────────────────────────────────────────────────
/// Emitted when the contract admin successfully upgrades the contract's
/// executable WASM bytecode via `upgrade()`.
///
/// Fields:
/// - `admin`: The address that authorized the upgrade (must match the
///   stored `DataKey::Admin`).
/// - `new_wasm_hash`: The SHA-256 hash of the new WASM bytecode that the
///   contract will now execute. This hash **must** correspond to a
///   `DeployerContract` install on the same network prior to calling
///   `upgrade()`.
/// - `previous_wasm_hash`: The SHA-256 hash of the WASM that was active
///   *before* the upgrade took effect.  This is populated by reading the
///   contract info from the host; on the rare off-chance the host cannot
///   resolve the current WASM hash this field will be all zeros and an
///   indexer should treat it as "unknown".
///
/// Storage compatibility note for indexers:
/// While the *new* WASM may add new fields to `#[contracttype]` structs
/// and new variants to `#[contracttype]` enums (appended at the end,
/// in both cases), it MUST NEVER reorder, rename, remove, or change
/// the type of *existing* fields or variants.  Violating this rule
/// corrupts every instance of that type already in storage.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContractUpgraded {
    pub admin: Address,
    pub new_wasm_hash: BytesN<32>,
    pub previous_wasm_hash: BytesN<32>,
}

/// Arbiter committee holding up to three arbiter addresses for dispute resolution.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbiterCommittee {
    pub members: Vec<Address>,
}

/// A recorded vote cast by a committee member on a dispute.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeVote {
    pub arbiter: Address,
    pub decision: bool,
}

/// Emitted when a committee member casts a vote on a dispute.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeVoteCast {
    pub bounty_id: u64,
    pub arbiter: Address,
    pub decision: bool,
}

/// Emitted once 2-of-3 quorum is reached and the dispute is resolved by the committee.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeResolved {
    pub bounty_id: u64,
    pub decision: bool,
}

// ─── Constants & Error Envelope ────────────────────────────────────────────

/// Maximum allowed bounty amount, enforced to prevent accidental
/// transfers of impossible sums.  1_000_000_000 * 10_000_000 stroops
/// covers the entire native XLM supply with headroom; for SAC tokens
/// with 7 decimals this still comfortably maps to the max i128.
pub const MAX_BOUNTY_AMOUNT: i128 = 1_000_000_000_000_000;

/// Default minimum arbiter bond, denominated in the bonded token's stroops
/// (100 XLM at 7 decimals). Overridable by the arbiter via
/// `set_min_arbiter_stake`, the same way `DEFAULT_MIN_BOUNTY_AMOUNT` is.
pub const DEFAULT_MIN_ARBITER_STAKE: i128 = 1_000_000_000;

/// Stable, machine-readable Soroban contract errors.
/// Codes 1-3 preserve the original README contract. Never renumber or reuse a
/// code; append a new explicit value when introducing a new failure mode.
#[soroban_sdk::contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ContractError {
    BountyNotOpen = 1,
    BountyNotFound = 2,
    BountyAlreadyReserved = 3,
    AlreadyInitialized = 4,
    NotInitialized = 5,
    NotAdmin = 6,
    NotArbiter = 7,
    ArbiterNotSet = 8,
    NoPendingArbiter = 9,
    TimelockNotElapsed = 10,
    InvalidAmount = 11,
    AmountTooSmall = 12,
    DeadlineMustBeInTheFuture = 13,
    DeadlineMustAdvance = 14,
    FeeRecipientNotSet = 15,
    TokenNotAllowed = 16,
    DisputeWindowOverrideTooSmall = 17,
    DisputeWindowOverrideTooLarge = 18,
    BountyMustBeReserved = 19,
    BountyMustBeSubmitted = 20,
    BountyNotExpiredYet = 21,
    BountyExpired = 22,
    BountyAlreadyFinalized = 23,
    CannotExtendFinalizedBounty = 24,
    MaintainerMismatch = 25,
    ContributorMismatch = 26,
    MissingContributor = 27,
    DisputeWindowNotMet = 28,
    ContractIsPaused = 29,
    /// The address has no bond, or less than `MinArbiterStake`.
    InsufficientArbiterStake = 30,
    /// A bond is held in a different token than the one being paid in.
    StakeTokenMismatch = 31,
    /// The address has never bonded, so there is nothing to slash.
    NoArbiterStake = 32,
    /// The requested slash is larger than the bond held.
    SlashExceedsStake = 33,
    /// Caller is not a registered arbiter committee member.
    NotCommitteeMember = 34,
    /// Committee member has already voted on this dispute.
    DuplicateCommitteeVote = 35,
    /// Committee exceeds maximum allowed members (3).
    CommitteeSizeExceeded = 36,
    /// Committee contains duplicate member addresses.
    DuplicateCommitteeMember = 37,
    /// Committee is not configured in contract storage.
    CommitteeNotConfigured = 38,
    InvalidFeeBps = 39,
    BountyIdOverflow = 40,
    BountyMustBeDisputed = 41,
    EscrowTransferFailed = 42,
    PayoutTransferFailed = 43,
    FeeTransferFailed = 44,
    RefundTransferFailed = 45,
}

fn panic_error(env: &Env, e: ContractError) -> ! {
    soroban_sdk::panic_with_error!(env, e)
}

#[contract]
pub struct StellarBountyBoardContract;

#[contractimpl]
impl StellarBountyBoardContract {
    // ─── Version ────────────────────────────────────────────────────────
    /// Returns the contract version as a semver string (e.g. "0.1.0").
    pub fn get_version(_env: Env) -> String {
        // We use _env because String::from_str needs it, but in future
        // Soroban SDK versions this may be optional for static strings.
        String::from_str(&_env, CONTRACT_VERSION)
    }

    /// Initializes the contract with the admin address, fee recipient,
    /// arbiter, and default dispute window (in seconds).
    ///
    /// # Escrow Initialization Boundaries (SBB-2026-401)
    ///
    /// - **One-time Invocation**: The contract must be initialized exactly once.
    ///   Re-initialization is blocked atomically by checking `DataKey::FeeRecipient`.
    /// - **Immutable Arbiter Identity**: The valid `arbiter` address supplied on the
    ///   first call is persisted to `DataKey::Arbiter` and becomes the authoritative
    ///   governance identity for arbiter-gated methods (`set_min_bounty_amount`, `pause`,
    ///   `unpause`, and dispute resolution).
    /// - **Zero Token Movement**: Initialization requires zero initial deposit and moves
    ///   zero tokens. Token balances for admin, arbiter, fee recipient, and contract
    ///   remain strictly unchanged.
    /// - **Zero Event Emission**: No lifecycle or escrow balance events are emitted during
    ///   initialization, preventing spurious indexing.
    /// - **Initialized State Defaults**: Configures `MinBountyAmount` to
    ///   [`DEFAULT_MIN_BOUNTY_AMOUNT`] (100) and `MinArbiterStake` to
    ///   [`DEFAULT_MIN_ARBITER_STAKE`]. `get_paused_state` defaults to `false` and
    ///   `get_next_bounty_id` is 0.
    ///
    /// # Panics
    ///
    /// Panics with `"already initialized"` if called more than once
    /// (detected by checking for `DataKey::FeeRecipient`).
    pub fn initialize(
        env: Env,
        admin: Address,
        fee_recipient: Address,
        arbiter: Address,
        dispute_window: u64,
    ) {
        // Prevent re-initialization
        if env.storage().persistent().has(&DataKey::FeeRecipient) {
            panic!("already initialized");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::FeeRecipient, &fee_recipient);
        env.storage().persistent().set(&DataKey::Arbiter, &arbiter);
        env.storage()
            .persistent()
            .set(&DataKey::DisputeWindow, &dispute_window);
        // Set default minimum bounty amount on initialization
        env.storage()
            .persistent()
            .set(&DataKey::MinBountyAmount, &DEFAULT_MIN_BOUNTY_AMOUNT);
        // Arbiters bond before they can be rotated in (see `set_arbiter`).
        // The genesis arbiter passed here is the deployer's own address and is
        // deliberately exempt: at genesis there is no prior governance to slash
        // a bond with, and requiring one would make the contract unusable until
        // the deployer had bonded a token it may not have configured yet. Every
        // *rotation* after genesis requires a bond.
        env.storage()
            .persistent()
            .set(&DataKey::MinArbiterStake, &DEFAULT_MIN_ARBITER_STAKE);
    }

    pub fn get_fee_recipient(env: Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::FeeRecipient)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    /// Returns the current minimum bounty amount required to create a bounty.
    /// If the contract has not been initialized, this will panic.
    pub fn get_min_bounty_amount(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::MinBountyAmount)
            .unwrap_or(DEFAULT_MIN_BOUNTY_AMOUNT)
    }

    /// Allows the arbiter to update the minimum bounty amount.
    /// Only callable by the configured arbiter address.
    pub fn set_min_bounty_amount(env: Env, new_min: i128) {
        let arbiter: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Arbiter)
            .unwrap_or_else(|| panic!("arbiter not set"));
        arbiter.require_auth();

        if new_min <= 0 {
            panic_error(&env, ContractError::InvalidAmount);
        }
        if new_min > MAX_BOUNTY_AMOUNT {
            panic_error(&env, ContractError::InvalidAmount);
        }

        env.storage()
            .persistent()
            .set(&DataKey::MinBountyAmount, &new_min);
    }

    // ─── Circuit Breaker ────────────────────────────────────────────────
    /// Pauses the contract, halting new bounty creation (and reservation).
    /// Only callable by the configured arbiter, which acts as the contract
    /// admin (the same role used by `set_min_bounty_amount`).
    /// Existing in-flight bounties can still be released, refunded, or
    /// disputed while paused.
    pub fn pause(env: Env) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Arbiter)
            .unwrap_or_else(|| panic!("arbiter not set"));
        admin.require_auth();

        env.storage().persistent().set(&DataKey::Paused, &true);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Pause")),
            ContractPaused { admin },
        );
    }

    /// Unpauses the contract, resuming new bounty creation (and reservation).
    /// Only callable by the configured arbiter (contract admin).
    pub fn unpause(env: Env) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Arbiter)
            .unwrap_or_else(|| panic!("arbiter not set"));
        admin.require_auth();

        env.storage().persistent().set(&DataKey::Paused, &false);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Unpaus")),
            ContractUnpaused { admin },
        );
    }

    /// Returns whether the contract is currently paused.
    /// Defaults to `false` (unpaused) if never explicitly set.
    pub fn get_paused_state(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Creates and escrows funds for a new bounty.
    ///
    /// This function is part of the public contract ABI. A maintainer locks funds
    /// into contract escrow, configuring bounty metadata, payout amounts, deadlines,
    /// protocol fees, and optional dispute resolution parameters.
    ///
    /// # Parameters
    /// * `env` - The Soroban contract environment.
    /// * `maintainer` - Address of the maintainer creating and funding the bounty.
    /// * `token` - Address of the accepted token used for payout and escrow.
    /// * `amount` - Amount of tokens escrowed for the bounty (`i128`).
    /// * `repo` - Repository identifier string (e.g., owner/repo).
    /// * `issue_number` - Issue number on the host repository (`u32`).
    /// * `title` - Title or descriptive summary of the bounty.
    /// * `deadline` - Ledger timestamp (`u64`) after which the bounty can be refunded.
    /// * `protocol_fee_bps` - Protocol fee in basis points (`u32`, 100 bps = 1%, max 10000).
    /// * `dispute_window_override` - Optional custom dispute window duration in seconds (`Option<u64>`).
    ///
    /// # Returns
    /// * `u64` - The unique ID assigned to the newly created bounty.
    ///
    /// # Authorisation
    /// * Requires authorization from the creating `maintainer` (`maintainer.require_auth()`).
    ///
    /// # Escrow funding boundaries (SBB-2026-406)
    ///
    /// * **Token units** — `amount` is denominated in the smallest unit of
    ///   `token` (stroops for the native SAC, the token's base unit otherwise).
    ///   The contract applies no decimal scaling: the funded amount is exactly
    ///   the value supplied, and it is the amount later released or refunded.
    /// * **Minimum supported amount** — the effective floor is
    ///   [`Self::get_min_bounty_amount`], which defaults to
    ///   [`DEFAULT_MIN_BOUNTY_AMOUNT`] and may be changed by the arbiter via
    ///   [`Self::set_min_bounty_amount`]. The floor is read at call time, so a
    ///   raised floor applies to subsequent fundings immediately.
    /// * **Below-minimum rejection** — any `amount` below the effective floor
    ///   is rejected with [`ContractError::AmountTooSmall`]. The check runs
    ///   before the token transfer, so a rejected funding moves no tokens and
    ///   consumes no bounty ID.
    /// * **One ID, one escrow balance** — a successful call allocates exactly
    ///   one new bounty ID and creates exactly one escrow balance for it, equal
    ///   to the funded `amount`. There is no partial or top-up funding path:
    ///   each bounty's escrow is fixed at creation.
    ///
    /// # Errors & Panic Paths
    /// * [`ContractError::ContractIsPaused`] - If the contract circuit-breaker is paused (`Self::get_paused_state`).
    /// * [`ContractError::InvalidAmount`] - If `amount <= 0` or exceeds `MAX_BOUNTY_AMOUNT`.
    /// * [`ContractError::AmountTooSmall`] - If `amount` is below the configured `min_bounty_amount`.
    /// * [`ContractError::DeadlineMustBeInTheFuture`] - If `deadline` is less than or equal to current ledger timestamp.
    /// * Panic (`fee exceeds 100%`) - If `protocol_fee_bps > 10_000`.
    /// * [`ContractError::FeeRecipientNotSet`] - If `protocol_fee_bps > 0` but no fee recipient is configured in storage.
    /// * [`ContractError::TokenNotAllowed`] - If `token` is not in the allowed token whitelist.
    /// * [`ContractError::DisputeWindowOverrideTooSmall`] - If `dispute_window_override` is provided and `< MIN_DISPUTE_WINDOW_OVERRIDE`.
    /// * [`ContractError::DisputeWindowOverrideTooLarge`] - If `dispute_window_override` is provided and `> MAX_DISPUTE_WINDOW_OVERRIDE`.
    /// * [`ContractError::EscrowTransferFailed`] - If the token transfer from maintainer to contract escrow fails.
    /// * [`ContractError::BountyIdOverflow`] - If `NextBountyId` counter overflows `u64`.
    ///
    /// # Atomicity & Escrow Funding Failure Guarantees
    /// * Parameter validation and maintainer authorization execute strictly before token transfer.
    /// * Token transfer occurs strictly prior to storage mutation and event emission.
    /// * If token transfer fails, the transaction aborts with [`ContractError::EscrowTransferFailed`], rolling back
    ///   cleanly without mutating [`DataKey::NextBountyId`] or storing [`DataKey::Bounty(id)`].
    /// * A failed call cannot strand or multiply escrow funds; retrying after funding will allocate the unconsumed sequential ID.
    ///
    /// # Storage
    /// * **Read**:
    ///   - [`DataKey::Paused`] - Verified via `get_paused_state`.
    ///   - [`DataKey::MinBountyAmount`] - Checked via `get_min_bounty_amount`.
    ///   - [`DataKey::FeeRecipient`] - Checked when `protocol_fee_bps > 0`.
    ///   - [`DataKey::AllowedTokens`] - Checked to ensure `token` is whitelisted.
    ///   - [`DataKey::NextBountyId`] - Read to determine the next available bounty ID.
    /// * **Write**:
    ///   - [`DataKey::NextBountyId`] - Incremented and updated with the new ID counter.
    ///   - [`DataKey::Bounty(next_id)`] - Persists the newly created [`Bounty`] with status [`BountyStatus::Open`].
    ///
    /// # Events
    /// * Emits `(symbol_short!("Bounty"), symbol_short!("Create"))` with [`BountyCreated`] payload.
    /// * Emits `(symbol_short!("Bounty"), symbol_short!("CrtEvent"))` with [`BountyCreatedEvent`] payload.
    /// * Emits exactly one escrow funding event
    ///   `(symbol_short!("Escrow"), symbol_short!("Funded"))` carrying the
    ///   canonical [`escrow_accounting::EscrowBalanceChanged`] payload.
    ///
    /// # Escrow funding event contract (SBB-2026-409)
    ///
    /// The funding event is the single, authoritative record of the escrow
    /// balance change caused by this call. Off-chain consumers can rely on:
    ///
    /// * **Exactly once** — one funding event per successful `create_bounty`.
    ///   No other code path in this contract emits `("Escrow", "Funded")`.
    /// * **Committed state only** — the event is published *after* the token
    ///   transfer into escrow has succeeded *and* the [`Bounty`] record has
    ///   been written to persistent storage. If either step fails the whole
    ///   invocation aborts (and Soroban rolls back storage and events), so a
    ///   funding event is never observable for a failed or rolled-back call.
    /// * **Reconstructable balance** — the payload carries the bounty ID, the
    ///   token/asset, the escrowed `amount`, the signed `delta` applied to the
    ///   escrow balance, the `previous_balance` before the change, the
    ///   `committed_balance` after it, and the resulting bounty `status`.
    ///   Consumers can apply `delta` to `previous_balance` to obtain
    ///   `committed_balance` and reconcile their view exactly once.
    pub fn create_bounty(
        env: Env,
        maintainer: Address,
        token: Address,
        amount: i128,
        repo: String,
        issue_number: u32,
        title: String,
        deadline: u64,
        protocol_fee_bps: u32,
        dispute_window_override: Option<u64>,
    ) -> u64 {
        maintainer.require_auth();

        if Self::get_paused_state(env.clone()) {
            panic_error(&env, ContractError::ContractIsPaused);
        }

        let min_amount = Self::get_min_bounty_amount(env.clone());

        // Escrow funding boundaries (SBB-2026-406): `amount` is in the token's
        // smallest unit and must be positive, within the hard cap, and at least
        // the effective minimum. All three checks run before any token movement
        // or storage write, so a rejected funding moves no funds and consumes
        // no bounty ID.
        if amount <= 0 || amount > MAX_BOUNTY_AMOUNT {
            panic_error(&env, ContractError::InvalidAmount);
        }
        if min_amount <= 0 || min_amount > MAX_BOUNTY_AMOUNT {
            // A misconfigured floor must not silently disable the boundary.
            panic_error(&env, ContractError::InvalidAmount);
        }
        if amount < min_amount {
            panic_error(&env, ContractError::AmountTooSmall);
        }
        if deadline <= env.ledger().timestamp() {
            panic_error(&env, ContractError::DeadlineMustBeInTheFuture);
        }
        //fee cannot exceed 100% (10000 bps)
        if protocol_fee_bps > 10_000 {
            panic_error(&env, ContractError::InvalidFeeBps);
        }
        if protocol_fee_bps > 0 && !env.storage().persistent().has(&DataKey::FeeRecipient) {
            panic_error(&env, ContractError::FeeRecipientNotSet);
        }
        if !is_token_allowed(&env, token.clone()) {
            panic_error(&env, ContractError::TokenNotAllowed);
        }

        // Validate dispute window override if provided
        if let Some(override_value) = dispute_window_override {
            if override_value < MIN_DISPUTE_WINDOW_OVERRIDE {
                panic_error(&env, ContractError::DisputeWindowOverrideTooSmall);
            }
            if override_value > MAX_DISPUTE_WINDOW_OVERRIDE {
                panic_error(&env, ContractError::DisputeWindowOverrideTooLarge);
            }
        }

        let token_client = TokenClient::new(&env, &token);
        let contract_address = env.current_contract_address();
        if !matches!(
            token_client.try_transfer(&maintainer, &contract_address, &amount),
            Ok(Ok(()))
        ) {
            panic_error(&env, ContractError::EscrowTransferFailed);
        }

        let mut next_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextBountyId)
            .unwrap_or(0);
        next_id = next_id
            .checked_add(1)
            .unwrap_or_else(|| panic_error(&env, ContractError::BountyIdOverflow));

        let bounty = Bounty {
            maintainer: maintainer.clone(),
            contributor: None,
            token: token.clone(),
            amount,
            repo: repo.clone(),
            issue_number,
            title: title.clone(),
            deadline,
            status: BountyStatus::Open,
            protocol_fee_bps,
            dispute_raised_at: 0,
            dispute_window_override,
        };

        env.storage()
            .persistent()
            .set(&DataKey::NextBountyId, &next_id);
        env.storage()
            .persistent()
            .set(&DataKey::Bounty(next_id), &bounty);

        // Escrow funding event: emitted exactly once, only after both the token
        // transfer above and the bounty record write have succeeded.
        escrow_accounting::publish_escrow_change(&env, next_id, &bounty, amount);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Fund")),
            BountyFunded {
                bounty_id: next_id,
                token: token.clone(),
                amount,
                escrow_balance: amount,
                status: BountyStatus::Open,
            },
        );

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Create")),
            BountyCreated {
                bounty_id: next_id,
                maintainer: maintainer.clone(),
                token: token.clone(),
                amount,
                repo: repo.clone(),
                issue_number,
                protocol_fee_bps,
            },
        );

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("CrtEvent")),
            BountyCreatedEvent {
                bounty_id: next_id,
                maintainer,
                token,
                amount,
                repo,
                issue_number,
                title,
                deadline,
                protocol_fee_bps,
                dispute_window_override,
                created_at: env.ledger().timestamp(),
            },
        );

        next_id
    }

    /// Reserves an open bounty for a specific contributor.
    ///
    /// This function is part of the public contract ABI. A contributor claims the
    /// exclusive right to work on an open bounty before submitting a solution.
    ///
    /// # Expiry Boundary
    /// * Expiration is evaluated strictly after the deadline (`now > bounty.deadline`).
    /// * A reservation at the exact expiry ledger (`now == bounty.deadline`) succeeds,
    ///   locking the single `contributor` while leaving the escrowed token balance
    ///   unchanged in the contract.
    /// * Any reservation at `now > bounty.deadline` is rejected with
    ///   [`ContractError::BountyExpired`].
    ///
    /// # Parameters
    /// * `env` - The Soroban contract environment.
    /// * `bounty_id` - Unique identifier (`u64`) of the bounty to reserve.
    /// * `contributor` - Address of the contributor reserving the bounty.
    ///
    /// # Authorisation
    /// * Requires authorization from the reserving `contributor` (`contributor.require_auth()`).
    ///
    /// # Errors & Panic Paths
    /// * [`ContractError::ContractIsPaused`] - If the contract circuit-breaker is paused (`Self::get_paused_state`).
    /// * [`ContractError::BountyNotFound`] - If no bounty exists with the given `bounty_id` (raised in `read_bounty`).
    /// * [`ContractError::BountyAlreadyReserved`] - If an unexpired bounty is reserved.
    /// * [`ContractError::BountyExpired`] - If the deadline elapsed or status is Expired.
    /// * [`ContractError::BountyNotOpen`] - If another non-open status prevents reservation.
    ///
    /// # Storage
    /// * **Read**:
    ///   - [`DataKey::Paused`] - Checked to verify active circuit-breaker state.
    ///   - [`DataKey::Bounty(bounty_id)`] - Reads the existing bounty state via `read_bounty`.
    /// * **Write**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Assigns `bounty.contributor` and transitions status to [`BountyStatus::Reserved`] via `write_bounty`.
    ///
    /// # Events
    /// * Emits `(symbol_short!("Bounty"), symbol_short!("Reserv"))` with [`BountyReserved`] payload.
    pub fn reserve_bounty(env: Env, bounty_id: u64, contributor: Address) {
        contributor.require_auth();

        if Self::get_paused_state(env.clone()) {
            panic_error(&env, ContractError::ContractIsPaused);
        }

        let mut bounty = read_bounty(&env, bounty_id);
        expire_if_needed(&env, &mut bounty);

        if bounty.status == BountyStatus::Expired {
            panic_error(&env, ContractError::BountyExpired);
        }
        if bounty.status == BountyStatus::Reserved {
            panic_error(&env, ContractError::BountyAlreadyReserved);
        }
        if bounty.status != BountyStatus::Open {
            panic_error(&env, ContractError::BountyNotOpen);
        }

        bounty.contributor = Some(contributor.clone());
        bounty.status = BountyStatus::Reserved;
        write_bounty(&env, bounty_id, &bounty);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Reserv")),
            BountyReserved {
                bounty_id,
                contributor,
            },
        );
    }

    pub fn reassign_bounty(
        env: Env,
        bounty_id: u64,
        maintainer: Address,
        new_contributor: Address,
    ) {
        maintainer.require_auth();

        let mut bounty = read_bounty(&env, bounty_id);
        expire_if_needed(&env, &mut bounty);

        if bounty.maintainer != maintainer {
            panic_error(&env, ContractError::MaintainerMismatch);
        }
        refresh_bounty_ttl(&env, bounty_id);

        if bounty.status != BountyStatus::Reserved {
            panic_error(&env, ContractError::BountyMustBeReserved);
        }

        let old_contributor = bounty
            .contributor
            .clone()
            .unwrap_or_else(|| panic_error(&env, ContractError::MissingContributor));

        bounty.contributor = Some(new_contributor.clone());
        write_bounty(&env, bounty_id, &bounty);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Reassign")),
            BountyReassigned {
                bounty_id,
                old_contributor,
                new_contributor,
            },
        );
    }

    /// Submits work for a reserved bounty, transitioning its status to `Submitted`.
    ///
    /// This function is part of the public contract ABI. The assigned contributor notifies
    /// the contract and maintainer that the deliverables for the bounty have been completed.
    ///
    /// # Submission Boundaries & Expiration Semantics
    /// * Submission is permitted strictly while `ledger.timestamp() <= bounty.deadline`.
    /// * At the exact boundary (`now == deadline`), authorized submission succeeds and transitions status to [`BountyStatus::Submitted`].
    /// * Once `now > deadline`, [`expire_if_needed`] marks the bounty as [`BountyStatus::Expired`] and submission is rejected with [`ContractError::BountyExpired`].
    /// * In both successful and failed paths, escrow and participant token balances remain invariant (zero tokens moved).
    /// * Once transitioned to [`BountyStatus::Submitted`], subsequent ledger timestamp advances past the deadline do not expire the bounty.
    ///
    /// # Parameters
    /// * `env` - The Soroban contract environment.
    /// * `bounty_id` - Unique identifier (`u64`) of the bounty being submitted.
    /// * `contributor` - Address of the assigned contributor submitting the work.
    ///
    /// # Authorisation
    /// * Requires authorization from `contributor` (`contributor.require_auth()`). Mismatched or unauthorized callers fail with [`ContractError::ContributorMismatch`].
    ///
    /// # Errors & Panic Paths
    /// * [`ContractError::BountyNotFound`] - If no bounty exists with the given `bounty_id` (via `read_bounty`).
    /// * [`ContractError::BountyExpired`] - If the bounty deadline has strictly passed (`now > deadline`).
    /// * [`ContractError::BountyMustBeReserved`] - If the bounty's status is not [`BountyStatus::Reserved`].
    /// * [`ContractError::MissingContributor`] - If the reserved bounty has no assigned contributor.
    /// * [`ContractError::ContributorMismatch`] - If `contributor` does not match the bounty's assigned worker (`bounty.contributor != Some(contributor)`).
    ///
    /// # Storage
    /// * **Read**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Reads the existing bounty state via `read_bounty`.
    /// * **Write**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Updates `bounty.status` to [`BountyStatus::Submitted`].
    ///
    /// # Events
    /// * Emits `(symbol_short!("Bounty"), symbol_short!("Submit"))` with [`BountySubmitted`] payload.
    pub fn submit_bounty(env: Env, bounty_id: u64, contributor: Address) {
        contributor.require_auth();
        let mut bounty = read_bounty(&env, bounty_id);
        expire_if_needed(&env, &mut bounty);

        if bounty.status == BountyStatus::Expired {
            panic_error(&env, ContractError::BountyExpired);
        }
        if bounty.status != BountyStatus::Reserved {
            panic_error(&env, ContractError::BountyMustBeReserved);
        }
        let assigned = bounty
            .contributor
            .as_ref()
            .unwrap_or_else(|| panic_error(&env, ContractError::MissingContributor));
        if assigned != &contributor {
            panic_error(&env, ContractError::ContributorMismatch);
        }

        bounty.status = BountyStatus::Submitted;
        write_bounty(&env, bounty_id, &bounty);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Submit")),
            BountySubmitted {
                bounty_id,
                contributor,
            },
        );
    }

    /// Releases an escrowed bounty payout to the assigned contributor after deducting protocol fees.
    ///
    /// This function is part of the public contract ABI. The bounty maintainer approves
    /// the submitted work, triggering token transfers from contract escrow: the net payout
    /// goes to the contributor, and any protocol fee is transferred to the treasury address.
    ///
    /// # Parameters
    /// * `env` - The Soroban contract environment.
    /// * `bounty_id` - Unique identifier (`u64`) of the bounty being released.
    /// * `maintainer` - Address of the bounty creator/maintainer approving the release.
    ///
    /// # Authorisation
    /// * Requires authorization from `maintainer` (`maintainer.require_auth()`).
    ///
    /// # Errors & Panic Paths
    /// * [`ContractError::BountyNotFound`] - If no bounty exists with the given `bounty_id` (via `read_bounty`).
    /// * [`ContractError::MaintainerMismatch`] - If the caller `maintainer` does not match the bounty's registered creator (`bounty.maintainer != maintainer`).
    /// * [`ContractError::BountyMustBeSubmitted`] - If the bounty's current status is not [`BountyStatus::Submitted`].
    /// * [`ContractError::MissingContributor`] - If the bounty has no assigned contributor.
    /// * [`ContractError::FeeRecipientNotSet`] - If `fee_amount > 0` and no fee recipient is configured in storage.
    /// * [`ContractError::PayoutTransferFailed`] - If the net payout token transfer to the contributor fails.
    /// * [`ContractError::FeeTransferFailed`] - If the protocol fee token transfer to the fee recipient fails.
    ///
    /// # Atomicity & Payout Failure Guarantees
    /// * Caller authorization, bounty status, contributor presence, and `FeeRecipient` (when `fee_amount > 0`) are validated before any state write or token transfer.
    /// * Terminal status ([`BountyStatus::Released`]) is committed prior to token transfers (Checks-Effects-Interactions).
    /// * If either the contributor payout transfer or the protocol fee transfer fails, the transaction aborts atomically with [`ContractError::PayoutTransferFailed`] or [`ContractError::FeeTransferFailed`], rolling back status, `FeeStats`, and any prior transfer in the same call without emitting events.
    /// * A failed call cannot strand or multiply escrow funds; retrying `release_bounty` after resolving the transfer failure settles the payout exactly once, and any subsequent release fails with [`ContractError::BountyMustBeSubmitted`].
    ///
    /// # Storage
    /// * **Read**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Reads the existing bounty state via `read_bounty`.
    ///   - [`DataKey::FeeRecipient`] - Persistent storage lookup to obtain the protocol fee recipient address if fees apply.
    /// * **Write**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Updates `bounty.status` to [`BountyStatus::Released`] before token transfers.
    ///   - [`DataKey::FeeStats`] - Updates cumulative fee statistics after transfers succeed.
    ///
    /// # Events & Payout Event Contract (SBB-2026-424)
    ///
    /// On a committed `release_bounty` call, exactly three contract events are
    /// emitted in this deterministic order, strictly after `BountyStatus::Released`,
    /// token transfers, and `FeeStats` updates have succeeded:
    ///
    /// 1. `(symbol_short!("Escrow"), symbol_short!("Balance"))` — [`escrow_accounting::EscrowBalanceChanged`]
    ///    with `amount = bounty.amount`, `delta = -bounty.amount`, `previous = bounty.amount`,
    ///    `remaining = 0`, and `status = BountyStatus::Released`.
    /// 2. `(symbol_short!("Bounty"), symbol_short!("Releas"))` — [`BountyReleased`]
    ///    with `amount = net_payout` and `fee_amount`.
    /// 3. `(symbol_short!("Bounty"), symbol_short!("RelEvent"))` — [`BountyReleasedEvent`]
    ///    with full self-contained payout details (`maintainer`, `contributor`, `token`,
    ///    `amount`, `fee_amount`, `protocol_fee_bps`, `released_at`).
    ///
    /// Exact escrow conservation: `net_payout + fee_amount == bounty.amount`.
    /// Consumers can reconstruct the committed payout once: failed or duplicate
    /// calls abort atomically and emit zero events.
    pub fn release_bounty(env: Env, bounty_id: u64, maintainer: Address) {
        maintainer.require_auth();
        let mut bounty = read_bounty(&env, bounty_id);

        if bounty.maintainer != maintainer {
            panic_error(&env, ContractError::MaintainerMismatch);
        }
        refresh_bounty_ttl(&env, bounty_id);
        if bounty.status != BountyStatus::Submitted {
            panic_error(&env, ContractError::BountyMustBeSubmitted);
        }

        let contributor = bounty
            .contributor
            .clone()
            .unwrap_or_else(|| panic_error(&env, ContractError::MissingContributor));

        let token_client = TokenClient::new(&env, &bounty.token);
        let contract_address = env.current_contract_address();

        // ── Fee calculation ─────────────────────────────────────────────
        // Fee is deducted FROM the payout, never added on top.
        // fee_amount = floor(amount * protocol_fee_bps / 10_000)
        // net_payout = amount - fee_amount
        //
        // Using i128 arithmetic to avoid overflow on large amounts.
        let fee_amount: i128 = if bounty.protocol_fee_bps == 0 {
            0
        } else {
            (bounty.amount * bounty.protocol_fee_bps as i128) / 10_000
        };

        let net_payout = bounty.amount - fee_amount;

        // Resolve fee recipient before committing state or initiating any transfer.
        let fee_recipient: Option<Address> = if fee_amount > 0 {
            Some(
                env.storage()
                    .persistent()
                    .get(&DataKey::FeeRecipient)
                    .unwrap_or_else(|| panic_error(&env, ContractError::FeeRecipientNotSet)),
            )
        } else {
            None
        };

        // Commit terminal state before interacting with token contract (Checks-Effects-Interactions).
        // If any subsequent token transfer fails, Soroban rolls back this write atomically.
        bounty.status = BountyStatus::Released;
        write_bounty(&env, bounty_id, &bounty);

        // Transfer net payout to contributor
        if !matches!(
            token_client.try_transfer(&contract_address, &contributor, &net_payout),
            Ok(Ok(()))
        ) {
            panic_error(&env, ContractError::PayoutTransferFailed);
        }

        // Transfer fee to recipient (only when fee is non-zero)
        if let Some(recipient) = fee_recipient {
            if !matches!(
                token_client.try_transfer(&contract_address, &recipient, &fee_amount),
                Ok(Ok(()))
            ) {
                panic_error(&env, ContractError::FeeTransferFailed);
            }
        }
        // ─────────────────────────────────────────────────────────────────

        // Atomically update FeeStats
        accumulate_fee_stats(&env, fee_amount);

        // Escrow funding event for the release path: the escrow balance for this
        // bounty drops to zero. Emitted exactly once, only after the terminal
        // state write and both payout transfers have succeeded.
        escrow_accounting::publish_escrow_change(&env, bounty_id, &bounty, -bounty.amount);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Releas")),
            BountyReleased {
                bounty_id,
                contributor: contributor.clone(),
                amount: net_payout, // net amount after fee
                fee_amount,
            },
        );

        // Structured, self-contained event scoped to `release_bounty`.
        // Topic: `(symbol_short!("Bounty"), symbol_short!("RelEvent"))`.
        // Payload: `BountyReleasedEvent` — sufficient for the indexer worker
        // to update its view of this bounty without a follow-up contract read.
        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("RelEvent")),
            BountyReleasedEvent {
                bounty_id,
                maintainer: bounty.maintainer.clone(),
                contributor,
                token: bounty.token.clone(),
                amount: net_payout,
                fee_amount,
                protocol_fee_bps: bounty.protocol_fee_bps,
                released_at: env.ledger().timestamp(),
            },
        );
    }

    /// Refunds the entire bounty amount back to the creator (maintainer) if expired and uncompleted.
    ///
    /// This function is part of the public contract ABI. A maintainer can reclaim their deposited
    /// tokens once the bounty deadline has passed, provided the bounty was never reserved and
    /// was not already released or refunded. The full original amount is returned without any
    /// protocol fees deducted.
    ///
    /// # Refund boundaries
    ///
    /// The refund is deliberately narrow. All of the following must hold:
    ///
    /// 1. **Expired-only** — the current ledger timestamp must be strictly greater than
    ///    `bounty.deadline`. A `deadline` of `0` is treated as a sentinel meaning "no deadline":
    ///    the expiry check is skipped and the refund proceeds regardless of `now`.
    /// 2. **Never-reserved-only** — a bounty that was ever reserved (i.e. `bounty.contributor`
    ///    is `Some`, or its status is anything other than [`BountyStatus::Open`] /
    ///    [`BountyStatus::Expired`]) cannot be refunded through this path. Reserved, submitted,
    ///    disputed, released and already-refunded bounties are all rejected with
    ///    [`ContractError::BountyAlreadyFinalized`]. Work that was reserved is settled through
    ///    [`Self::release_bounty`] or the dispute-resolution paths instead.
    /// 3. **Single-shot** — the status is moved to [`BountyStatus::Refunded`] and persisted
    ///    *before* the token transfer, so a second call (or a re-entrant call) fails with
    ///    [`ContractError::BountyAlreadyFinalized`] rather than paying out twice.
    /// 4. **Exact-amount** — exactly `bounty.amount` is transferred, with no fee deduction and
    ///    no rounding.
    /// 5. **Maintainer-only payee** — the tokens always go to `bounty.maintainer`, the address
    ///    that funded the escrow. The caller cannot redirect the refund elsewhere.
    ///
    /// # Parameters
    /// * `env` - The Soroban contract environment.
    /// * `bounty_id` - Unique identifier (`u64`) of the bounty to refund.
    /// * `maintainer` - Address of the bounty creator requesting the refund.
    ///
    /// # Authorisation
    /// * Requires authorization from the specified `maintainer` (`maintainer.require_auth()`).
    /// * Only the bounty's registered maintainer may call this. A contributor, the arbiter, or
    ///   any other address — even one that signs the call — is rejected with
    ///   [`ContractError::MaintainerMismatch`] and cannot redirect the escrow.
    ///
    /// # Errors & Panic Paths
    /// * [`ContractError::BountyNotFound`] - If no bounty exists with the given `bounty_id` (via `read_bounty`).
    /// * [`ContractError::MaintainerMismatch`] - If `maintainer` does not match the bounty's registered creator (`bounty.maintainer != maintainer`).
    /// * [`ContractError::BountyAlreadyFinalized`] - If the bounty was ever reserved, or its status is not [`BountyStatus::Open`] / [`BountyStatus::Expired`] (including already [`BountyStatus::Released`] or [`BountyStatus::Refunded`]).
    /// * [`ContractError::BountyNotExpiredYet`] - If the current ledger timestamp is less than or equal to `bounty.deadline` (and `bounty.deadline != 0`).
    /// * [`ContractError::RefundTransferFailed`] - If the token transfer back to the maintainer fails.
    ///
    /// # Storage
    /// * **Read**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Reads the existing bounty state via `read_bounty`.
    /// * **Write**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Updates `bounty.status` to [`BountyStatus::Refunded`] via `write_bounty`, before the transfer.
    ///
    /// # Events
    /// * Emits exactly one `(symbol_short!("Bounty"), symbol_short!("Refund"))`
    ///   event with [`BountyRefunded`] only after `BountyStatus::Refunded` is
    ///   committed and the full escrow transfer succeeds.
    pub fn refund_bounty(env: Env, bounty_id: u64, maintainer: Address) {
        maintainer.require_auth();
        let mut bounty = read_bounty(&env, bounty_id);
        expire_if_needed(&env, &mut bounty);

        // Only the bounty's own maintainer may reclaim the escrow. A contributor
        // or the arbiter signing this call is rejected here, before any state or
        // funds move.
        if bounty.maintainer != maintainer {
            panic_error(&env, ContractError::MaintainerMismatch);
        }
        refresh_bounty_ttl(&env, bounty_id);

        // Refunds are for bounties that were never reserved. Once a contributor
        // is attached (or the bounty left Open/Expired), settlement belongs to
        // the release or dispute paths, not to the maintainer's refund.
        if bounty.contributor.is_some()
            || (bounty.status != BountyStatus::Open && bounty.status != BountyStatus::Expired)
        {
            panic_error(&env, ContractError::BountyAlreadyFinalized);
        }

        let now = env.ledger().timestamp();
        if now <= bounty.deadline && bounty.deadline != 0 {
            panic_error(&env, ContractError::BountyNotExpiredYet);
        }

        // Mark the bounty refunded before moving tokens so a second attempt
        // fails with `BountyAlreadyFinalized` instead of paying out twice.
        bounty.status = BountyStatus::Refunded;
        write_bounty(&env, bounty_id, &bounty);

        let token_client = TokenClient::new(&env, &bounty.token);
        let contract_address = env.current_contract_address();

        // Refund returns the FULL original amount there is no fee on refunds
        if !matches!(
            token_client.try_transfer(&contract_address, &bounty.maintainer, &bounty.amount),
            Ok(Ok(()))
        ) {
            panic_error(&env, ContractError::RefundTransferFailed);
        }

        // Escrow funding event for the refund path: the escrow balance for this
        // bounty drops to zero. Emitted exactly once, only after the terminal
        // state write and the refund transfer have both succeeded.
        escrow_accounting::publish_escrow_change(&env, bounty_id, &bounty, -bounty.amount);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Refund")),
            BountyRefunded {
                bounty_id,
                maintainer: bounty.maintainer.clone(),
                token: bounty.token,
                amount: bounty.amount,
                refunded_at: env.ledger().timestamp(),
            },
        );
    }

    pub fn cancel_bounty(env: Env, bounty_id: u64, maintainer: Address) {
        maintainer.require_auth();
        let mut bounty = read_bounty(&env, bounty_id);
        expire_if_needed(&env, &mut bounty);

        if bounty.maintainer != maintainer {
            panic_error(&env, ContractError::MaintainerMismatch);
        }
        refresh_bounty_ttl(&env, bounty_id);
        if bounty.status != BountyStatus::Open {
            panic_error(&env, ContractError::BountyNotOpen);
        }

        let token_client = TokenClient::new(&env, &bounty.token);
        let contract_address = env.current_contract_address();

        // Commit the terminal state before interacting with the token contract.
        // If the transfer returns an error, panic_error aborts the invocation,
        // which rolls back this write and preserves the escrow state atomically.
        bounty.status = BountyStatus::Refunded;
        write_bounty(&env, bounty_id, &bounty);

        if !matches!(
            token_client.try_transfer(&contract_address, &maintainer, &bounty.amount),
            Ok(Ok(()))
        ) {
            panic_error(&env, ContractError::RefundTransferFailed);
        }

        // Escrow funding event for the cancel path: the escrow balance for this
        // bounty drops to zero. Emitted exactly once, only after the terminal
        // state write and the refund transfer have both succeeded.
        escrow_accounting::publish_escrow_change(&env, bounty_id, &bounty, -bounty.amount);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Cancel")),
            BountyCanceled {
                bounty_id,
                maintainer,
                amount: bounty.amount,
            },
        );
    }

    pub fn extend_deadline(env: Env, bounty_id: u64, maintainer: Address, new_deadline: u64) {
        maintainer.require_auth();
        let mut bounty = read_bounty(&env, bounty_id);
        expire_if_needed(&env, &mut bounty);

        if bounty.maintainer != maintainer {
            panic_error(&env, ContractError::MaintainerMismatch);
        }
        refresh_bounty_ttl(&env, bounty_id);

        if bounty.status == BountyStatus::Released
            || bounty.status == BountyStatus::Refunded
            || bounty.status == BountyStatus::Expired
        {
            panic_error(&env, ContractError::CannotExtendFinalizedBounty);
        }

        if new_deadline <= bounty.deadline {
            panic_error(&env, ContractError::DeadlineMustAdvance);
        }

        bounty.deadline = new_deadline;
        write_bounty(&env, bounty_id, &bounty);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Extnd")),
            BountyDeadlineExtended {
                bounty_id,
                new_deadline,
            },
        );
    }

    /// Raises a dispute on a submitted bounty, transitioning its status to `Disputed`.
    ///
    /// This function is part of the public contract ABI. A contributor who has submitted
    /// work for a bounty can raise a dispute if there is a conflict or disagreement with
    /// the maintainer before the deadline passes.
    ///
    /// # Dispute window semantics
    ///
    /// The dispute window is bounded by the bounty `deadline`:
    /// * The **last eligible ledger** is exactly `deadline` — a dispute raised at
    ///   `now == deadline` is accepted.
    /// * The window is **exclusive after** `deadline` — a dispute raised at
    ///   `now > deadline` is rejected with [`ContractError::BountyExpired`].
    ///
    /// The recorded `dispute_raised_at` is the ledger timestamp of the accepted
    /// call; `resolve_dispute` then requires
    /// `now >= dispute_raised_at + effective_dispute_window`.
    ///
    /// # Single-shot guarantee
    ///
    /// Only a bounty in [`BountyStatus::Submitted`] can be disputed. Once the
    /// transition commits, the status is [`BountyStatus::Disputed`] and any
    /// further call (including one after a release or refund) is rejected with
    /// [`ContractError::BountyMustBeSubmitted`]. The state is written exactly
    /// once and the event is emitted only after the write, so consumers see at
    /// most one `BountyDisputed` event per bounty.
    ///
    /// # Funds
    ///
    /// Raising a dispute moves no tokens: escrow remains intact and is only
    /// settled later by `resolve_dispute` (or the committee vote path).
    ///
    /// # Parameters
    /// * `env` - The Soroban contract environment.
    /// * `bounty_id` - Unique identifier (`u64`) of the bounty being disputed.
    /// * `arbiter` - Address of the arbiter handling dispute resolution. Must match
    ///   the contract's currently configured arbiter stored in persistent storage.
    ///
    /// # Authorisation
    /// * Requires authorization from the bounty's assigned `contributor` (`contributor.require_auth()`).
    ///
    /// # Errors & Panic Paths
    /// * [`ContractError::BountyNotFound`] - If no bounty exists with the given `bounty_id` (via `read_bounty`).
    /// * [`ContractError::BountyExpired`] - If the current ledger timestamp is past the bounty's `deadline` (`env.ledger().timestamp() > bounty.deadline`).
    /// * [`ContractError::MissingContributor`] - If the bounty does not have an assigned contributor (`bounty.contributor` is `None`).
    /// * [`ContractError::BountyMustBeSubmitted`] - If the bounty's current status is not [`BountyStatus::Submitted`]
    ///   (this also covers already `Disputed`, `Released`, `Refunded`, and `Expired` bounties).
    /// * [`ContractError::ArbiterNotSet`] - If no arbiter has been configured in persistent storage (`DataKey::Arbiter`).
    /// * [`ContractError::NotArbiter`] - If the provided `arbiter` argument does not match the stored arbiter address.
    ///
    /// # Storage
    /// * **Read**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Reads the existing bounty state via `read_bounty`.
    ///   - [`DataKey::Arbiter`] - Persistent storage lookup to verify the arbiter address.
    /// * **Write**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Updates `bounty.status` to [`BountyStatus::Disputed`] and records `bounty.dispute_raised_at` timestamp.
    ///
    /// # Events
    /// * Emits exactly one `(symbol_short!("Bounty"), symbol_short!("Dispt"))` event with the
    ///   [`BountyDisputed`] payload, after the state write. Fields are ordered
    ///   `bounty_id`, `contributor`, `arbiter`, `dispute_raised_at`, `deadline`.
    pub fn dispute_bounty(env: Env, bounty_id: u64, arbiter: Address) {
        let mut bounty = read_bounty(&env, bounty_id);

        // Last eligible ledger is exactly `deadline`; strictly after is too late.
        if env.ledger().timestamp() > bounty.deadline {
            panic_error(&env, ContractError::BountyExpired);
        }

        let contributor = bounty
            .contributor
            .clone()
            .unwrap_or_else(|| panic_error(&env, ContractError::MissingContributor));

        contributor.require_auth();

        // Single-shot: only a Submitted bounty may transition to Disputed. This
        // rejects Disputed (double dispute), Released, Refunded, and Expired.
        if bounty.status != BountyStatus::Submitted {
            panic_error(&env, ContractError::BountyMustBeSubmitted);
        }

        let stored_arbiter: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Arbiter)
            .unwrap_or_else(|| panic_error(&env, ContractError::ArbiterNotSet));

        if arbiter != stored_arbiter {
            panic_error(&env, ContractError::NotArbiter);
        }

        let dispute_raised_at = env.ledger().timestamp();
        bounty.status = BountyStatus::Disputed;
        bounty.dispute_raised_at = dispute_raised_at;
        write_bounty(&env, bounty_id, &bounty);

        // Emitted only after the committed state, so the event and storage agree.
        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Dispt")),
            BountyDisputed {
                bounty_id,
                contributor,
                arbiter,
                dispute_raised_at,
                deadline: bounty.deadline,
            },
        );
    }

    /// Settles a disputed bounty by directing the full escrowed balance to one
    /// final payout destination.
    ///
    /// # Boundaries
    /// - **Authorization**: Requires explicit authorization from the stored
    ///   `DataKey::Arbiter`.
    /// - **Status**: Only bounties in [`BountyStatus::Disputed`] may be
    ///   resolved; all other statuses (including already settled bounties) fail
    ///   with [`ContractError::BountyMustBeDisputed`], preserving one final
    ///   decision.
    /// - **Ledger Window**: Enforces
    ///   `env.ledger().timestamp() >= bounty.dispute_raised_at + effective_dispute_window`
    ///   (using `bounty.dispute_window_override` if set, otherwise global
    ///   `DataKey::DisputeWindow`), rejecting earlier timestamps with
    ///   [`ContractError::DisputeWindowNotMet`].
    /// - **Exact Destinations & Token Units**:
    ///   - `release == true`: transitions to [`BountyStatus::Released`],
    ///     transfers `amount - floor(amount * protocol_fee_bps / 10_000)` to
    ///     the contributor and any positive fee to `FeeRecipient`.
    ///   - `release == false`: transitions to [`BountyStatus::Refunded`] and
    ///     returns the full `amount` (zero fee) to `bounty.maintainer`.
    /// - **Events**: Emits the escrow balance delta and a single
    ///   `(Bounty, Reslv)` [`BountyResolved`] event only after terminal state
    ///   and token transfers succeed.
    pub fn resolve_dispute(env: Env, bounty_id: u64, release: bool) {
        let arbiter: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Arbiter)
            .unwrap_or_else(|| panic_error(&env, ContractError::ArbiterNotSet));

        arbiter.require_auth();

        let mut bounty = read_bounty(&env, bounty_id);
        refresh_bounty_ttl(&env, bounty_id);

        if bounty.status != BountyStatus::Disputed {
            panic_error(&env, ContractError::BountyMustBeDisputed);
        }

        // Use per-bounty override if set, otherwise fall back to global default
        let effective_dispute_window: u64 = bounty.dispute_window_override.unwrap_or_else(|| {
            env.storage()
                .persistent()
                .get(&DataKey::DisputeWindow)
                .unwrap_or(0)
        });

        if env.ledger().timestamp() < bounty.dispute_raised_at + effective_dispute_window {
            panic_error(&env, ContractError::DisputeWindowNotMet);
        }

        let token_client = TokenClient::new(&env, &bounty.token);
        let contract_address = env.current_contract_address();

        if release {
            let contributor = bounty
                .contributor
                .clone()
                .unwrap_or_else(|| panic_error(&env, ContractError::MissingContributor));

            let fee_amount: i128 = if bounty.protocol_fee_bps == 0 {
                0
            } else {
                (bounty.amount * bounty.protocol_fee_bps as i128) / 10_000
            };

            let net_payout = bounty.amount - fee_amount;

            // Commit terminal state before interacting with token contract
            bounty.status = BountyStatus::Released;
            write_bounty(&env, bounty_id, &bounty);

            if !matches!(
                token_client.try_transfer(&contract_address, &contributor, &net_payout),
                Ok(Ok(()))
            ) {
                panic_error(&env, ContractError::PayoutTransferFailed);
            }

            if fee_amount > 0 {
                let fee_recipient: Address = env
                    .storage()
                    .persistent()
                    .get(&DataKey::FeeRecipient)
                    .unwrap_or_else(|| panic_error(&env, ContractError::FeeRecipientNotSet));
                if !matches!(
                    token_client.try_transfer(&contract_address, &fee_recipient, &fee_amount),
                    Ok(Ok(()))
                ) {
                    panic_error(&env, ContractError::FeeTransferFailed);
                }
            }

            // Atomically update FeeStats for the dispute-release path
            accumulate_fee_stats(&env, fee_amount);
        } else {
            // Commit terminal state before interacting with token contract
            bounty.status = BountyStatus::Refunded;
            write_bounty(&env, bounty_id, &bounty);

            if !matches!(
                token_client.try_transfer(&contract_address, &bounty.maintainer, &bounty.amount),
                Ok(Ok(()))
            ) {
                panic_error(&env, ContractError::RefundTransferFailed);
            }
        }

        // Escrow funding event for the dispute-resolution path: the escrow
        // balance for this bounty drops to zero. Emitted exactly once, only
        // after the terminal state write and the settlement transfers have
        // succeeded.
        escrow_accounting::publish_escrow_change(&env, bounty_id, &bounty, -bounty.amount);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Reslv")),
            BountyResolved {
                bounty_id,
                arbiter,
                release,
                amount: bounty.amount,
            },
        );
    }

    /// Retrieves the current state of a bounty by its unique identifier.
    ///
    /// This function is part of the public contract ABI. If the bounty's deadline
    /// has elapsed and its status is either [`BountyStatus::Open`] or [`BountyStatus::Reserved`],
    /// the returned in-memory status is updated to [`BountyStatus::Expired`] via `expire_if_needed`.
    ///
    /// # Parameters
    /// * `env` - The Soroban contract environment.
    /// * `bounty_id` - Unique identifier (`u64`) of the bounty to retrieve.
    ///
    /// # Returns
    /// * [`Bounty`] - The requested bounty struct with lazily-evaluated expiration.
    ///
    /// # Authorisation
    /// * None (public view query; no caller authentication or signatures required).
    ///
    /// # Errors & Panic Paths
    /// * [`ContractError::BountyNotFound`] - If no bounty exists with the given `bounty_id` (raised in `read_bounty`).
    ///
    /// # Storage
    /// * **Read**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Reads the bounty state from persistent storage via `read_bounty`.
    /// * **Write**:
    ///   - None (read-only query; expiration status mutation is purely in-memory).
    pub fn get_bounty(env: Env, bounty_id: u64) -> Bounty {
        let mut bounty = read_bounty(&env, bounty_id);
        expire_if_needed(&env, &mut bounty);
        bounty
    }

    // ---------- New Functions ----------
    pub fn init(env: Env, appeal_window: u64) {
        // Only allow setting once
        if env.storage().persistent().has(&DataKey::Config) {
            panic!("config already set");
        }
        let cfg = Config { appeal_window };
        env.storage().persistent().set(&DataKey::Config, &cfg);
    }

    /// Schedules a resolution for `bounty_id` and starts the appeal window.
    ///
    /// This does not move funds: it records the ruling in
    /// `DataKey::PendingResolution` so that either party can [`Self::appeal`]
    /// during the configured `appeal_window`, after which
    /// [`Self::finalize_resolution`] executes it. The immediate,
    /// window-enforced path is [`Self::resolve_dispute`], which settles in the
    /// same call.
    ///
    /// Named `propose_resolution` rather than `resolve_dispute` because the
    /// older dispute-window path already owns that name on this contract, and
    /// a contract cannot expose two `resolve_dispute` entry points.
    ///
    /// # Parameters
    /// * `bounty_id` - The disputed bounty.
    /// * `decision` - `0` to release to the contributor, `1` to refund the
    ///   maintainer. Any other value panics.
    ///
    /// Emits `("Dispute", "Scheduled")` through [`Self::finalize_resolution`]'s
    /// counterpart event.
    pub fn propose_resolution(env: Env, bounty_id: u64, decision: u32) {
        let arbiter: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Arbiter)
            .unwrap_or_else(|| panic_error(&env, ContractError::ArbiterNotSet));
        arbiter.require_auth();
        let decision = match decision {
            0 => DisputeDecision::Release,
            1 => DisputeDecision::Refund,
            _ => panic!("invalid decision"),
        };
        let timestamp = env.ledger().timestamp();
        let pending = PendingResolution {
            decision: decision.clone(),
            timestamp,
        };
        env.storage()
            .persistent()
            .set(&DataKey::PendingResolution(bounty_id), &pending);
        env.events().publish(
            (symbol_short!("Dispute"), symbol_short!("Scheduled")),
            DisputeResolutionScheduled {
                bounty_id,
                decision,
                resolve_at: timestamp,
            },
        );
    }

    pub fn finalize_resolution(env: Env, bounty_id: u64) {
        // Load pending
        let pending_opt: Option<PendingResolution> = env
            .storage()
            .persistent()
            .get(&DataKey::PendingResolution(bounty_id));
        let pending = pending_opt.expect("no pending resolution");
        // Load config
        let cfg: Config = env
            .storage()
            .persistent()
            .get(&DataKey::Config)
            .expect("config not set");
        let now = env.ledger().timestamp();
        if now < pending.timestamp + cfg.appeal_window {
            panic!("appeal window not elapsed");
        }
        // Load bounty
        let mut bounty = read_bounty(&env, bounty_id);
        refresh_bounty_ttl(&env, bounty_id);
        // Resolve based on decision
        match pending.decision {
            DisputeDecision::Release => {
                // transfer to contributor
                let contributor = bounty
                    .contributor
                    .clone()
                    .unwrap_or_else(|| panic!("missing contributor"));
                let token_client = TokenClient::new(&env, &bounty.token);
                token_client.transfer(
                    &env.current_contract_address(),
                    &contributor,
                    &bounty.amount,
                );
                bounty.status = BountyStatus::Released;
                write_bounty(&env, bounty_id, &bounty);
                // Escrow funding event: emitted exactly once, only after the
                // terminal state write and the payout transfer have succeeded.
                escrow_accounting::publish_escrow_change(&env, bounty_id, &bounty, -bounty.amount);

                env.events().publish(
                    (symbol_short!("Bounty"), symbol_short!("Releas")),
                    BountyReleased {
                        bounty_id,
                        contributor,
                        amount: bounty.amount,
                        // This path pays the contributor the full escrowed
                        // amount: it takes no protocol fee, so the event
                        // reports none.
                        fee_amount: 0,
                    },
                );
            }
            DisputeDecision::Refund => {
                let maintainer = bounty.maintainer.clone();
                let token_client = TokenClient::new(&env, &bounty.token);
                bounty.status = BountyStatus::Refunded;
                write_bounty(&env, bounty_id, &bounty);
                if !matches!(
                    token_client.try_transfer(
                        &env.current_contract_address(),
                        &maintainer,
                        &bounty.amount,
                    ),
                    Ok(Ok(()))
                ) {
                    panic_error(&env, ContractError::RefundTransferFailed);
                }
                // Escrow funding event: emitted exactly once, only after the
                // terminal state write and the refund transfer have succeeded.
                escrow_accounting::publish_escrow_change(&env, bounty_id, &bounty, -bounty.amount);

                env.events().publish(
                    (symbol_short!("Bounty"), symbol_short!("Refund")),
                    BountyRefunded {
                        bounty_id,
                        maintainer: maintainer.clone(),
                        token: bounty.token,
                        amount: bounty.amount,
                        refunded_at: env.ledger().timestamp(),
                    },
                );
            }
        }
        // Remove pending
        env.storage()
            .persistent()
            .remove(&DataKey::PendingResolution(bounty_id));
    }

    pub fn appeal(env: Env, bounty_id: u64) {
        let pending_opt: Option<PendingResolution> = env
            .storage()
            .persistent()
            .get(&DataKey::PendingResolution(bounty_id));
        let pending = pending_opt.expect("no pending resolution");
        let cfg: Config = env
            .storage()
            .persistent()
            .get(&DataKey::Config)
            .expect("config not set");
        let now = env.ledger().timestamp();
        if now >= pending.timestamp + cfg.appeal_window {
            panic!("appeal window elapsed");
        }
        // Verify caller is losing party
        let bounty = read_bounty(&env, bounty_id);
        match pending.decision {
            DisputeDecision::Release => {
                // loser is maintainer
                bounty.maintainer.require_auth();
            }
            DisputeDecision::Refund => {
                // loser is contributor
                if let Some(contrib) = bounty.contributor.clone() {
                    contrib.require_auth();
                } else {
                    panic!("no contributor to appeal");
                }
            }
        }
        // Remove pending to block finalization until re-resolved
        env.storage()
            .persistent()
            .remove(&DataKey::PendingResolution(bounty_id));
        env.events().publish(
            (symbol_short!("Dispute"), symbol_short!("Appealed")),
            DisputeAppealed { bounty_id },
        );
    }

    pub fn get_next_bounty_id(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::NextBountyId)
            .unwrap_or(0)
    }

    /// Read-only view function to enumerate bounties on-chain.
    pub fn get_all_bounties(env: Env, start: u64, limit: u32) -> Vec<Bounty> {
        let enforced_limit = if limit > 50 { 50 } else { limit };
        let mut result = Vec::new(&env);

        let next_id = env
            .storage()
            .persistent()
            .get(&DataKey::NextBountyId)
            .unwrap_or(0);

        // Return empty Vec immediately if start is out of bounds or invalid
        if start == 0 || start > next_id || enforced_limit == 0 {
            return result;
        }

        let mut id = start;
        let mut count = 0u32;

        // Loop up to the limit or until we exceed the highest allocated bounty ID
        while count < enforced_limit && id <= next_id {
            // Check if the bounty actually exists in storage before reading to prevent a panic
            if env.storage().persistent().has(&DataKey::Bounty(id)) {
                let mut bounty = read_bounty(&env, id);
                expire_if_needed(&env, &mut bounty);
                result.push_back(bounty);
            }
            id += 1;
            count += 1;
        }

        result
    }

    /// Returns all bounties where the contributor field matches the given address,
    /// using the same start/limit pagination as [`get_all_bounties`].
    ///
    /// Only bounties in `Reserved`, `Submitted`, `Released`, or `Disputed` state
    /// are ever returned — `Open` bounties have no contributor and are always
    /// excluded.  `Expired` and `Refunded` bounties that were previously reserved
    /// by this contributor will also appear so callers can see their full history.
    ///
    /// The `limit` parameter is capped at 50 matching the rest of the API.
    pub fn get_bounties_by_contributor(
        env: Env,
        contributor: Address,
        start: u64,
        limit: u32,
    ) -> Vec<Bounty> {
        let enforced_limit = if limit > 50 { 50 } else { limit };
        let mut result = Vec::new(&env);

        if enforced_limit == 0 {
            return result;
        }

        let next_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextBountyId)
            .unwrap_or(0);

        if start == 0 || start > next_id {
            return result;
        }

        let mut id = start;

        while result.len() < enforced_limit && id <= next_id {
            if env.storage().persistent().has(&DataKey::Bounty(id)) {
                let mut bounty = read_bounty(&env, id);
                expire_if_needed(&env, &mut bounty);
                // Include the bounty only if this contributor was assigned to it
                if bounty.contributor.as_ref() == Some(&contributor) {
                    result.push_back(bounty);
                }
            }
            id += 1;
        }

        result
    }

    /// Returns the cumulative fee statistics for the contract.
    ///
    /// Returns a [`FeeStats`] with `total_collected = 0` and `bounty_count = 0`
    /// if no bounties have been released yet.
    pub fn get_fee_stats(env: Env) -> FeeStats {
        env.storage()
            .persistent()
            .get(&DataKey::FeeStats)
            .unwrap_or(FeeStats {
                total_collected: 0,
                bounty_count: 0,
            })
    }

    /// Returns the effective dispute window for a bounty.
    /// If the bounty has a per-bounty override, returns that value.
    /// Otherwise returns the global DisputeWindow configured at initialization.
    pub fn get_effective_dispute_window(env: Env, bounty_id: u64) -> u64 {
        let bounty = read_bounty(&env, bounty_id);
        bounty.dispute_window_override.unwrap_or_else(|| {
            env.storage()
                .persistent()
                .get(&DataKey::DisputeWindow)
                .unwrap_or(0)
        })
    }
    // ─── Arbiter Bond ───────────────────────────────────────────────────
    /// Bonds `amount` of `token` as the calling address's arbiter stake.
    ///
    /// # Why a bond at all
    ///
    /// An arbiter decides who gets paid when a bounty is disputed, which is a
    /// decision about someone else's money that the contract cannot second-guess
    /// on-chain. A bond is what turns that decision into a cost: the arbiter has
    /// funds sitting in this contract, in a token it chose to stake, that the
    /// admin can forfeit to the treasury with `slash_arbiter` if the ruling was
    /// bad. The bond is therefore required *before* taking office — a candidate
    /// with nothing at stake has nothing to lose by ruling badly, and a bond
    /// posted after the fact would be paid only by arbiters who expect to be
    /// slashed anyway.
    ///
    /// # Parameters
    /// * `arbiter` - The address bonding. Must authorize this call.
    /// * `token` - The token the bond is paid in. The contract handles several
    ///   tokens (each bounty escrows its own), so a bond states the one it is
    ///   denominated in; topping up an existing bond must use the same token.
    /// * `amount` - Amount bonded by this call, in that token's stroops.
    ///
    /// # Panics
    /// * `InvalidAmount` - If `amount` is zero or negative.
    /// * `StakeTokenMismatch` - If the address already bonded in another token.
    /// * Token client panics if the transfer from `arbiter` fails.
    ///
    /// Emits [`ArbiterBonded`] with the amount added and the resulting total.
    pub fn bond_arbiter_stake(env: Env, arbiter: Address, token: Address, amount: i128) {
        arbiter.require_auth();

        if amount <= 0 {
            panic_error(&env, ContractError::InvalidAmount);
        }

        let key = DataKey::ArbiterStake(arbiter.clone());
        let existing: Option<ArbiterStake> = env.storage().persistent().get(&key);

        let total = match &existing {
            Some(stake) => {
                if stake.token != token {
                    panic_error(&env, ContractError::StakeTokenMismatch);
                }
                stake
                    .amount
                    .checked_add(amount)
                    .unwrap_or_else(|| panic_error(&env, ContractError::InvalidAmount))
            }
            None => amount,
        };

        // The tokens move into the contract, not merely into storage: a slash is
        // only credible if the funds to pay it are already escrowed here.
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&arbiter, &env.current_contract_address(), &amount);

        env.storage().persistent().set(
            &key,
            &ArbiterStake {
                token: token.clone(),
                amount: total,
            },
        );

        env.events().publish(
            (symbol_short!("Arbiter"), symbol_short!("Bonded")),
            ArbiterBonded {
                arbiter,
                token,
                amount,
                total,
            },
        );
    }

    /// Returns the bond currently held for `arbiter`, if they ever bonded.
    pub fn get_arbiter_stake(env: Env, arbiter: Address) -> Option<ArbiterStake> {
        env.storage()
            .persistent()
            .get(&DataKey::ArbiterStake(arbiter))
    }

    /// Returns the bond an arbitration candidate must hold to take office.
    pub fn get_min_arbiter_stake(env: Env) -> i128 {
        read_min_arbiter_stake(&env)
    }

    /// Returns the address currently holding the arbiter role.
    ///
    /// Rotation is timelocked, so between `set_arbiter` and `confirm_arbiter`
    /// the proposed candidate is not yet the arbiter; `get_arbiter` answers
    /// "who can rule today", which is the question the bond gates.
    pub fn get_arbiter(env: Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::Arbiter)
            .unwrap_or_else(|| panic_error(&env, ContractError::ArbiterNotSet))
    }

    /// Allows the arbiter to update the minimum bond required of candidates.
    ///
    /// Only callable by the configured arbiter, mirroring
    /// `set_min_bounty_amount`. Raising it does not evict the arbiter in office:
    /// the rotation path (`set_arbiter` / `confirm_arbiter`) is what enforces it,
    /// so an incumbent that falls below a raised minimum stays in place until the
    /// next rotation.
    pub fn set_min_arbiter_stake(env: Env, new_min: i128) {
        let arbiter: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Arbiter)
            .unwrap_or_else(|| panic!("arbiter not set"));
        arbiter.require_auth();

        if new_min <= 0 {
            panic_error(&env, ContractError::InvalidAmount);
        }
        if new_min > MAX_BOUNTY_AMOUNT {
            panic_error(&env, ContractError::InvalidAmount);
        }

        env.storage()
            .persistent()
            .set(&DataKey::MinArbiterStake, &new_min);
    }

    /// Forfeits part of an arbiter's bond to the protocol treasury.
    ///
    /// Admin-gated: the same account that proposes arbiters is the one that can
    /// make a bad ruling cost them. The tokens were escrowed by
    /// `bond_arbiter_stake`, so the contract can pay without the arbiter's
    /// cooperation — which is the whole point of holding them.
    ///
    /// An arbiter slashed below the minimum is left in office rather than
    /// removed: removing them would bypass the two-day rotation timelock, and a
    /// slashed-but-incumbent arbiter has no influence over the next rotation.
    /// Their shortfall is visible to anyone through `get_arbiter_stake`, and it
    /// stops the next `set_arbiter` / `confirm_arbiter` for that address.
    ///
    /// # Parameters
    /// * `arbiter` - The address whose bond is forfeited.
    /// * `amount` - Amount to forfeit, in stroops of the bonded token.
    /// * `reason` - Free-form reason, carried in the event for indexers.
    ///
    /// # Panics
    /// * `NotAdmin` - If the stored admin did not authorize this call.
    /// * `InvalidAmount` - If `amount` is zero or negative.
    /// * `NoArbiterStake` - If the address holds no bond.
    /// * `SlashExceedsStake` - If `amount` is greater than the bond held.
    /// * `FeeRecipientNotSet` - If the contract has no treasury configured.
    ///
    /// Emits [`ArbiterSlashed`] with the amount forfeited and what remains.
    pub fn slash_arbiter(env: Env, arbiter: Address, amount: i128, reason: String) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_error(&env, ContractError::NotAdmin));
        admin.require_auth();

        if amount <= 0 {
            panic_error(&env, ContractError::InvalidAmount);
        }

        let key = DataKey::ArbiterStake(arbiter.clone());
        let mut stake: ArbiterStake = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_error(&env, ContractError::NoArbiterStake));

        if amount > stake.amount {
            panic_error(&env, ContractError::SlashExceedsStake);
        }

        // The treasury is the fee recipient already configured on this contract;
        // protocol funds have one destination rather than two.
        let treasury: Address = env
            .storage()
            .persistent()
            .get(&DataKey::FeeRecipient)
            .unwrap_or_else(|| panic_error(&env, ContractError::FeeRecipientNotSet));

        stake.amount -= amount;
        env.storage().persistent().set(&key, &stake);

        let token_client = TokenClient::new(&env, &stake.token);
        token_client.transfer(&env.current_contract_address(), &treasury, &amount);

        env.events().publish(
            (symbol_short!("Arbiter"), symbol_short!("Slashed")),
            ArbiterSlashed {
                arbiter,
                token: stake.token,
                amount,
                remaining: stake.amount,
                treasury,
                reason,
            },
        );
    }

    pub fn set_arbiter(env: Env, new_arbiter: Address) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_error(&env, ContractError::NotAdmin));
        admin.require_auth();

        // A candidate takes office bonded, or not at all. Checked here as well as
        // at confirmation: the bond can be slashed during the two-day wait.
        require_min_arbiter_stake(&env, &new_arbiter);

        env.storage()
            .persistent()
            .set(&DataKey::PendingArbiter, &new_arbiter);

        let timelock = env.ledger().timestamp() + 86400 * 2; // 2 days delay
        env.storage()
            .persistent()
            .set(&DataKey::ArbiterRotationTimelock, &timelock);

        env.events().publish(
            (symbol_short!("Arbiter"), symbol_short!("Proposed")),
            ArbiterRotationProposed {
                new_arbiter,
                unlock_time: timelock,
            },
        );
    }

    pub fn confirm_arbiter(env: Env) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_error(&env, ContractError::NotAdmin));
        admin.require_auth();

        let pending_arbiter: Address = env
            .storage()
            .persistent()
            .get(&DataKey::PendingArbiter)
            .unwrap_or_else(|| panic_error(&env, ContractError::NoPendingArbiter));

        let timelock: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ArbiterRotationTimelock)
            .unwrap_or_else(|| panic_error(&env, ContractError::NoPendingArbiter));

        if env.ledger().timestamp() < timelock {
            panic_error(&env, ContractError::TimelockNotElapsed);
        }

        // Re-checked here: a slash during the timelock must not let an
        // under-bonded address into office through the back door.
        require_min_arbiter_stake(&env, &pending_arbiter);

        let old_arbiter: Address = env.storage().persistent().get(&DataKey::Arbiter).unwrap();

        env.storage()
            .persistent()
            .set(&DataKey::Arbiter, &pending_arbiter);
        env.storage().persistent().remove(&DataKey::PendingArbiter);
        env.storage()
            .persistent()
            .remove(&DataKey::ArbiterRotationTimelock);

        env.events().publish(
            (symbol_short!("Arbiter"), symbol_short!("Confirmd")),
            ArbiterRotationConfirmed {
                old_arbiter,
                new_arbiter: pending_arbiter,
            },
        );
    }

    /// Admin: set allowlist enabled state
    pub fn set_allowlist_enabled(env: Env, admin: Address, enabled: bool) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_error(&env, ContractError::NotAdmin));
        if admin != stored_admin {
            panic_error(&env, ContractError::NotAdmin);
        }
        admin.require_auth();
        let mut config = get_allowlist_config(&env);
        config.enabled = enabled;
        env.storage()
            .instance()
            .set(&DataKey::AllowlistConfig, &config);
    }

    /// Admin: add a token to the allowlist
    pub fn add_allowed_token(env: Env, admin: Address, token: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_error(&env, ContractError::NotAdmin));
        if admin != stored_admin {
            panic_error(&env, ContractError::NotAdmin);
        }
        admin.require_auth();
        let mut config = get_allowlist_config(&env);
        if !config.allowed_tokens.contains(&token) {
            config.allowed_tokens.push_back(token.clone());
            env.storage()
                .instance()
                .set(&DataKey::AllowlistConfig, &config);
            env.events()
                .publish((symbol_short!("allowlist"), symbol_short!("add")), token);
        }
    }

    /// Admin: remove a token from the allowlist
    pub fn remove_allowed_token(env: Env, admin: Address, token: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_error(&env, ContractError::NotAdmin));
        if admin != stored_admin {
            panic_error(&env, ContractError::NotAdmin);
        }
        admin.require_auth();
        let mut config = get_allowlist_config(&env);

        if let Some(index) = config.allowed_tokens.first_index_of(&token) {
            config.allowed_tokens.remove(index);
            env.storage()
                .instance()
                .set(&DataKey::AllowlistConfig, &config);
            env.events()
                .publish((symbol_short!("allowlist"), symbol_short!("remove")), token);
        }
    }

    // ─── Contract Upgrade ────────────────────────────────────────────────
    /// Upgrades the contract's executable WASM bytecode to the version
    /// identified by `new_wasm_hash`.
    ///
    /// # High-Level Procedure
    ///
    /// 1. **Authorization**.  The caller is looked up from persistent
    ///    `DataKey::Admin` and its `require_auth()` is invoked, which
    ///    enforces that a valid signature / soroban-auth envelope for
    ///    the admin address.  **Only the stored admin may call this
    ///    function; any other caller panics with
    ///    `ContractError::NotAdmin`.
    ///
    /// 2. **Capture previous WASM hash**.  Before performing the upgrade,
    ///    `env.deployer().get_contract_info(...)` is used to
    ///    record the current WASM hash so it can be emitted in the
    ///    [`ContractUpgraded`] event.  If the host cannot resolve
    ///    the hash (which should never happen on a live network, but can
    ///    may happen in unusual test configurations) the field is set to a zero-filled
    ///    `BytesN<32>` and the event is still emitted.
    ///
    /// 3. **Perform the upgrade**.  `env.deployer().update_current_contract_wasm(new_wasm_hash)`
    ///    is invoked.  This is the single operation on the host that atomically
    ///    replaces the WASM backing this contract ID.  The hash **must** already
    ///    be a WASM previously uploaded to the network via `DeployerContract::install`,
    ///    otherwise the host will trap.
    ///
    /// 4. **Emit event**.  A `ContractUpgraded event is published with
    ///    `(symbol_short!("Cntrct"), symbol_short!("Upgrade")) topics
    ///    containing the admin address, the previous WASM hash, and the
    ///    new WASM hash for indexers and clients.
    ///
    /// # ⚠️ Storage Compatibility Requirements (CRITICAL)
    ///
    /// This function performs a **hot-swap of the executable** — **without** any
    /// migration of the on-chain storage**.  All bytes previously written by the old
    /// contract remain in place and are interpreted by the new WASM.  If the
    /// new WASM uses incompatible type definitions, **every stored value of that
    /// type becomes silently corrupted and the contract will trap on next
    /// read.
    ///
    /// Therefore the following rules MUST be followed for every upgrade:
    ///
    /// ## 1. `#[contracttype]` **Structs** — Append-Only Fields
    ///
    /// - ✅ **ALLOWED**: Append **new fields at the END** of the struct
    ///   declaration.  The Soroban host tolerates trailing fields.  The new optional /
    ///   will be zero-value (zero for numerics, `None` for `Option`, empty
    ///   for `Vec`/`Map`, etc) when a record written by the old
    ///   WASM is read by the new WASM.
    ///
    /// - ❌ **FORBIDDEN**:
    ///   - Reordering existing fields.
    ///   - Renaming existing fields (the field name is not stored, but the
    ///     ordinal position **is**; renaming and keeping position is
    ///     *accidentally* safe but extremely fragile and must never be relied
    ///     upon; prefer append with a `_v2` field instead).
    ///   - Changing the type of an existing field (e.g. `u64` → `u128`,
    ///     or `Address` → `BytesN<32>`).
    ///   - Inserting a new field **before** an existing field.
    ///   - Deleting any existing field.
    ///
    /// ## 2. `#[contracttype]` **Enums** — Append-Only Variants
    ///
    /// - ✅ **ALLOWED**: Append **new variants at the END** of the
    ///   enum declaration.  The discriminant is implicit `Nth variant
    ///   value, so inserting in the middle corrupts every subsequent
    ///   discriminant.
    ///
    /// - ❌ **FORBIDDEN**:
    ///   - Reordering existing variants.
    ///   - Inserting a new variant anywhere except the last position.
    ///   - Removing an existing variant.
    ///   - Changing the **arity** or **tuple/struct-body type layout of an
    ///     existing variant (e.g. `Vote(Address)` →
    ///     `Vote(Address, u64)` or `Vote { voter: Address }`).
    ///
    /// ## 3. `DataKey` Enum — Same Rules, and Never Reuse Discriminants
    ///
    /// The `DataKey` enum is the root of every persisted key and obeys the
    /// same append-only rules.  In addition:
    ///
    /// - NEVER repurpose a removed `DataKey::Foo(u64)` variant; even if
    ///   no writes to `Foo` exist, a future migration code may collide
    ///   with stale tombstones.  Always append a brand new variant.
    ///
    /// ## 4. `Vec`, `Map`, `BytesN<N>` Types
    ///
    /// - The length prefix is part of the on wire format; **N is fixed.**
    ///   cannot widen (e.g. `BytesN<32>` → `BytesN<64>`); that is a
    ///   different type.  Introduce a new field / new variant.
    ///
    /// ## 5. Semver Discipline
    ///
    /// Before deploying a breaking storage change (i.e., anything other than a
    /// struct/enum append), the safe path is:
    ///
    /// 1. Deploy a **new contract new contract ID (fresh storage).
    /// 2. Add a migration entry-point callable only by admin that reads
    ///    state from the legacy contract and writes it into the new one
    ///    in a bounded batch.
    /// 3. Redirect integrators the new contract address.
    ///
    /// # Arguments
    ///
    /// - `env`: The host environment.
    /// - `new_wasm_hash`: The 32-byte SHA-256 hash of the new WASM
    ///   bytecode, as returned by the `Deployer` when the WASM was
    ///   installed on-chain.  The hash **must** match an installed
    ///   WASM on the same network, else the host traps.
    ///
    /// # Panics
    ///
    /// Panics with `ContractError::NotAdmin` if the caller is not
    /// the stored admin.  Panics propagated from
    /// `deployer().update_current_contract_wasm` when the hash does not
    /// correspond to a currently installed WASM.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_error(&env, ContractError::NotAdmin));
        admin.require_auth();

        // The host exposes no "what wasm am I running" query through
        // `Deployer`, so the contract records the hash it last upgraded to and
        // reports that. Before the first upgrade the value is unknown, which is
        // the same fallback this function used when introspection was
        // unavailable.
        let previous_wasm_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::WasmHash)
            .unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32]));

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        env.storage()
            .persistent()
            .set(&DataKey::WasmHash, &new_wasm_hash);

        env.events().publish(
            (symbol_short!("Cntrct"), symbol_short!("Upgrade")),
            ContractUpgraded {
                admin: admin.clone(),
                new_wasm_hash,
                previous_wasm_hash,
            },
        );
    }

    // ─── Multi-Arbiter Committee Voting (Issue #727) ─────────────────────────

    /// Configures the multi-arbiter dispute committee members (up to 3 addresses).
    ///
    /// Requires authorization from the contract admin.
    /// Rejects more than 3 members or duplicate addresses.
    pub fn set_arbiter_committee(env: Env, arbiters: Vec<Address>) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_error(&env, ContractError::NotAdmin));
        admin.require_auth();

        if arbiters.len() > 3 {
            panic_error(&env, ContractError::CommitteeSizeExceeded);
        }

        // Ensure all member addresses are distinct
        for i in 0..arbiters.len() {
            for j in (i + 1)..arbiters.len() {
                if arbiters.get(i).unwrap() == arbiters.get(j).unwrap() {
                    panic_error(&env, ContractError::DuplicateCommitteeMember);
                }
            }
        }

        let committee = ArbiterCommittee { members: arbiters };
        env.storage()
            .persistent()
            .set(&DataKey::ArbiterCommittee, &committee);
    }

    /// Returns the registered dispute committee members.
    pub fn get_arbiter_committee(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get::<_, ArbiterCommittee>(&DataKey::ArbiterCommittee)
            .map(|c| c.members)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Returns all votes cast so far on a disputed bounty.
    pub fn get_dispute_votes(env: Env, bounty_id: u64) -> Vec<DisputeVote> {
        env.storage()
            .persistent()
            .get::<_, Vec<DisputeVote>>(&DataKey::DisputeVotes(bounty_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Casts a vote by a committee arbiter on a disputed bounty.
    ///
    /// # Parameters
    /// * `bounty_id` - The ID of the disputed bounty.
    /// * `arbiter` - The committee arbiter casting the vote.
    /// * `decision` - `true` to release funds to the contributor, `false` to refund to maintainer.
    ///
    /// # Rules & Guarantees
    /// * Requires authentication from `arbiter` (`arbiter.require_auth()`).
    /// * Arbiter must be in the registered `ArbiterCommittee`.
    /// * Rejects duplicate votes from the same committee member.
    /// * Emits a `DisputeVoteCast` event for every recorded vote.
    /// * Tallies votes; once 2 matching votes are recorded (2-of-3 quorum):
    ///   - Executes token transfer:
    ///     - If release (`true`): net amount to contributor, protocol fee to fee recipient, updates FeeStats.
    ///     - If refund (`false`): full amount to maintainer.
    ///   - Sets status to `Released` or `Refunded`.
    ///   - Emits a `DisputeResolved` event.
    ///   - Returns `true`.
    /// * If quorum is not yet reached (e.g. 1st vote or 1-1 split):
    ///   - Funds remain in escrow, status remains `Disputed`.
    ///   - Returns `false`.
    pub fn vote_resolve_dispute(
        env: Env,
        bounty_id: u64,
        arbiter: Address,
        decision: bool,
    ) -> bool {
        let committee: ArbiterCommittee = env
            .storage()
            .persistent()
            .get(&DataKey::ArbiterCommittee)
            .unwrap_or_else(|| panic_error(&env, ContractError::CommitteeNotConfigured));

        if !committee.members.contains(&arbiter) {
            panic_error(&env, ContractError::NotCommitteeMember);
        }

        arbiter.require_auth();

        let mut bounty = read_bounty(&env, bounty_id);
        if bounty.status != BountyStatus::Disputed {
            panic_error(&env, ContractError::BountyMustBeDisputed);
        }

        let mut votes: Vec<DisputeVote> = env
            .storage()
            .persistent()
            .get(&DataKey::DisputeVotes(bounty_id))
            .unwrap_or_else(|| Vec::new(&env));

        // Check for duplicate vote
        for v in votes.iter() {
            if v.arbiter == arbiter {
                panic_error(&env, ContractError::DuplicateCommitteeVote);
            }
        }

        votes.push_back(DisputeVote {
            arbiter: arbiter.clone(),
            decision,
        });
        env.storage()
            .persistent()
            .set(&DataKey::DisputeVotes(bounty_id), &votes);

        // Emit DisputeVoteCast
        env.events().publish(
            (symbol_short!("Dispute"), symbol_short!("Vote")),
            DisputeVoteCast {
                bounty_id,
                arbiter,
                decision,
            },
        );

        // Tally votes
        let mut release_votes = 0u32;
        let mut refund_votes = 0u32;
        for v in votes.iter() {
            if v.decision {
                release_votes += 1;
            } else {
                refund_votes += 1;
            }
        }

        if release_votes >= 2 {
            let contributor = bounty
                .contributor
                .clone()
                .unwrap_or_else(|| panic_error(&env, ContractError::MissingContributor));

            let fee_amount: i128 = if bounty.protocol_fee_bps == 0 {
                0
            } else {
                (bounty.amount * bounty.protocol_fee_bps as i128) / 10_000
            };
            let net_payout = bounty.amount - fee_amount;

            let token_client = TokenClient::new(&env, &bounty.token);
            let contract_address = env.current_contract_address();

            // Commit terminal state before interacting with token contract
            bounty.status = BountyStatus::Released;
            write_bounty(&env, bounty_id, &bounty);

            if !matches!(
                token_client.try_transfer(&contract_address, &contributor, &net_payout),
                Ok(Ok(()))
            ) {
                panic_error(&env, ContractError::PayoutTransferFailed);
            }

            if fee_amount > 0 {
                let fee_recipient: Address = env
                    .storage()
                    .persistent()
                    .get(&DataKey::FeeRecipient)
                    .unwrap_or_else(|| panic_error(&env, ContractError::FeeRecipientNotSet));
                if !matches!(
                    token_client.try_transfer(&contract_address, &fee_recipient, &fee_amount),
                    Ok(Ok(()))
                ) {
                    panic_error(&env, ContractError::FeeTransferFailed);
                }
            }

            accumulate_fee_stats(&env, fee_amount);

            // Escrow funding event: emitted exactly once, only after the
            // terminal state write and the payout transfers have succeeded.
            escrow_accounting::publish_escrow_change(&env, bounty_id, &bounty, -bounty.amount);

            env.events().publish(
                (symbol_short!("Dispute"), symbol_short!("Reslvd")),
                DisputeResolved {
                    bounty_id,
                    decision: true,
                },
            );

            true
        } else if refund_votes >= 2 {
            let token_client = TokenClient::new(&env, &bounty.token);
            let contract_address = env.current_contract_address();

            // Commit terminal state before interacting with token contract
            bounty.status = BountyStatus::Refunded;
            write_bounty(&env, bounty_id, &bounty);

            if !matches!(
                token_client.try_transfer(&contract_address, &bounty.maintainer, &bounty.amount),
                Ok(Ok(()))
            ) {
                panic_error(&env, ContractError::RefundTransferFailed);
            }

            // Escrow funding event: emitted exactly once, only after the
            // terminal state write and the refund transfer have succeeded.
            escrow_accounting::publish_escrow_change(&env, bounty_id, &bounty, -bounty.amount);

            env.events().publish(
                (symbol_short!("Dispute"), symbol_short!("Reslvd")),
                DisputeResolved {
                    bounty_id,
                    decision: false,
                },
            );

            true
        } else {
            false
        }
    }
}

// ─── Helper Functions ────────────────────────────────────────────────────────

fn read_bounty(env: &Env, bounty_id: u64) -> Bounty {
    env.storage()
        .persistent()
        .get(&DataKey::Bounty(bounty_id))
        .unwrap_or_else(|| panic_error(env, ContractError::BountyNotFound))
}

fn refresh_bounty_ttl(env: &Env, bounty_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::Bounty(bounty_id),
        BOUNTY_STORAGE_TTL_THRESHOLD,
        BOUNTY_STORAGE_TTL_EXTEND_TO,
    );
}

fn write_bounty(env: &Env, bounty_id: u64, bounty: &Bounty) {
    env.storage()
        .persistent()
        .set(&DataKey::Bounty(bounty_id), bounty);
}

fn expire_if_needed(env: &Env, bounty: &mut Bounty) {
    let now = env.ledger().timestamp();
    if now > bounty.deadline
        && (bounty.status == BountyStatus::Open || bounty.status == BountyStatus::Reserved)
    {
        bounty.status = BountyStatus::Expired;
    }
}

fn get_allowlist_config(env: &Env) -> AllowlistConfig {
    env.storage()
        .instance()
        .get::<_, AllowlistConfig>(&DataKey::AllowlistConfig)
        .unwrap_or_else(|| AllowlistConfig {
            enabled: false,
            allowed_tokens: Vec::new(env),
        })
}

/// The minimum bond an arbitration candidate must hold, defaulting to
/// [`DEFAULT_MIN_ARBITER_STAKE`] on a contract written before the key existed.
fn read_min_arbiter_stake(env: &Env) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::MinArbiterStake)
        .unwrap_or(DEFAULT_MIN_ARBITER_STAKE)
}

/// Panics unless `arbiter` holds at least the configured minimum bond.
///
/// This is the gate the acceptance criteria describe: an address that has not
/// bonded (or has been slashed below the minimum) cannot be made the active
/// arbiter.
fn require_min_arbiter_stake(env: &Env, arbiter: &Address) {
    let min = read_min_arbiter_stake(env);
    let held: i128 = env
        .storage()
        .persistent()
        .get::<_, ArbiterStake>(&DataKey::ArbiterStake(arbiter.clone()))
        .map(|stake| stake.amount)
        .unwrap_or(0);

    if held < min {
        panic_error(env, ContractError::InsufficientArbiterStake);
    }
}

/// Check if a token is allowed to fund bounties
fn is_token_allowed(env: &Env, token: Address) -> bool {
    let config = get_allowlist_config(env);
    if !config.enabled {
        return true;
    }
    config.allowed_tokens.contains(token)
}

/// Atomically add `fee_amount` to the cumulative [`FeeStats`] in persistent storage.
///
/// Called after every payout (normal release and dispute-release). When `fee_amount`
/// is zero the stats are still updated so that `bounty_count` always reflects the
/// total number of released bounties, not just fee-paying ones.
fn accumulate_fee_stats(env: &Env, fee_amount: i128) {
    let mut stats: FeeStats = env
        .storage()
        .persistent()
        .get(&DataKey::FeeStats)
        .unwrap_or(FeeStats {
            total_collected: 0,
            bounty_count: 0,
        });

    stats.total_collected = stats
        .total_collected
        .checked_add(fee_amount)
        .unwrap_or_else(|| panic_error(env, ContractError::InvalidAmount));
    stats.bounty_count = stats
        .bounty_count
        .checked_add(1)
        .unwrap_or_else(|| panic_error(env, ContractError::BountyIdOverflow));

    env.storage().persistent().set(&DataKey::FeeStats, &stats);
}
