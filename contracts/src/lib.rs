#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::Client as TokenClient, Address,
    BytesN, Env, String, Vec,
};

// ─── Contract Version ───────────────────────────────────────────────────
/// Semver string pulled from Cargo.toml at compile time.
pub const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Minimum allowed bounty amount to prevent dust bounties.
/// Default: 100 stroops (0.00001 XLM).
/// This can be overridden by the contract admin via `set_min_bounty_amount`.
pub const DEFAULT_MIN_BOUNTY_AMOUNT: i128 = 100;

/// Minimum allowed per-bounty dispute window override (1 minute in seconds).
pub const MIN_DISPUTE_WINDOW_OVERRIDE: u64 = 60;

/// Maximum allowed per-bounty dispute window override (30 days in seconds).
pub const MAX_DISPUTE_WINDOW_OVERRIDE: u64 = 2_592_000;

/// Keep bounty records alive while a state-changing operation is using them.
/// These values are deliberately below the network maximum so a mutation can
/// refresh an entry without making its rent horizon unbounded.
const BOUNTY_STORAGE_TTL_THRESHOLD: u32 = 1_000;
const BOUNTY_STORAGE_TTL_EXTEND_TO: u32 = 4_096;

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
/// that the indexer worker can react without polling the whole contract
/// state. The payload carries every field the worker needs to update its
/// view of the bounty without a follow-up contract read:
/// - `bounty_id`: which bounty was released.
/// - `maintainer`: who authorized the release.
/// - `contributor`: who received the net payout.
/// - `token`: the token the bounty was escrowed in.
/// - `amount`: the net payout to the contributor (after fee).
/// - `fee_amount`: the protocol fee transferred to the fee recipient.
/// - `protocol_fee_bps`: the fee rate locked in at creation time.
/// - `released_at`: the ledger timestamp at which the release occurred.
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
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyRefunded {
    pub bounty_id: u64,
    pub maintainer: Address,
    pub amount: i128,
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
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyDisputed {
    pub bounty_id: u64,
    pub contributor: Address,
    pub arbiter: Address,
}

/// Emitted when an arbiter resolves a dispute (release or refund).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyResolved {
    pub bounty_id: u64,
    pub arbiter: Address,
    pub release: bool,
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

        if amount <= 0 || amount > MAX_BOUNTY_AMOUNT {
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
    /// # Parameters
    /// * `env` - The Soroban contract environment.
    /// * `bounty_id` - Unique identifier (`u64`) of the bounty being submitted.
    /// * `contributor` - Address of the assigned contributor submitting the work.
    ///
    /// # Authorisation
    /// * Requires authorization from `contributor` (`contributor.require_auth()`).
    ///
    /// # Errors & Panic Paths
    /// * [`ContractError::BountyNotFound`] - If no bounty exists with the given `bounty_id` (via `read_bounty`).
    /// * [`ContractError::BountyMustBeReserved`] - If the bounty's status is not [`BountyStatus::Reserved`].