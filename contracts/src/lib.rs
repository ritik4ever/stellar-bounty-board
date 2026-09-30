#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    token::Client as TokenClient, Address, BytesN, Env, String, Vec,
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

/// Shared error-code taxonomy between Soroban contract errors and backend
/// HTTP error responses.
///
/// Each discriminant is the stable numeric error code surfaced as
/// `error.code` in API responses. The backend maps these codes to HTTP
/// status codes using [`ContractError::http_status`]; the human-readable
/// message is [`ContractError::message`].
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContractError {
    AlreadyInitialized = 1001,
    NotAdmin = 1002,
    ArbiterNotSet = 1003,
    NotArbiter = 1004,
    InvalidAmount = 1005,
    AmountTooSmall = 1006,
    DeadlineMustBeInTheFuture = 1007,
    FeeExceedsMax = 1008,
    FeeRecipientNotSet = 1009,
    TokenNotAllowed = 1010,
    DisputeWindowOverrideTooSmall = 1011,
    DisputeWindowOverrideTooLarge = 1012,
    ContractIsPaused = 1013,
    BountyNotFound = 1014,
    BountyNotOpen = 1015,
    BountyMustBeReserved = 1016,
    MissingContributor = 1017,
    MaintainerMismatch = 1018,
    ContributorMismatch = 1019,
    BountyMustBeSubmitted = 1020,
    BountyAlreadyFinalized = 1021,
    BountyNotExpiredYet = 1022,
    CannotExtendFinalizedBounty = 1023,
    DeadlineMustAdvance = 1024,
    BountyExpired = 1025,
    BountyNotDisputed = 1026,
    DisputeWindowNotMet = 1027,
    ConfigAlreadySet = 1028,
    ConfigNotSet = 1029,
    NoPendingResolution = 1030,
    AppealWindowNotElapsed = 1031,
    AppealWindowElapsed = 1032,
    InvalidDecision = 1033,
    NoPendingArbiter = 1034,
    TimelockNotElapsed = 1035,
}

impl ContractError {
    /// Returns the stable numeric error code included in API responses.
    pub fn code(self) -> u32 {
        self as u32
    }

    /// Returns the human-readable message associated with this error code.
    pub fn message(&self) -> &'static str {
        match self {
            Self::AlreadyInitialized => "contract has already been initialized",
            Self::NotAdmin => "caller is not the contract admin",
            Self::ArbiterNotSet => "contract arbiter has not been configured",
            Self::NotArbiter => "caller is not the configured arbiter",
            Self::InvalidAmount => "amount must be greater than zero and within limits",
            Self::AmountTooSmall => "amount is below the minimum bounty amount",
            Self::DeadlineMustBeInTheFuture => "deadline must be in the future",
            Self::FeeExceedsMax => "protocol fee cannot exceed 100% (10000 bps)",
            Self::FeeRecipientNotSet => "fee recipient has not been configured",
            Self::TokenNotAllowed => "token is not on the allowlist",
            Self::DisputeWindowOverrideTooSmall => "dispute window override is below the minimum",
            Self::DisputeWindowOverrideTooLarge => "dispute window override exceeds the maximum",
            Self::ContractIsPaused => "contract is paused",
            Self::BountyNotFound => "bounty does not exist",
            Self::BountyNotOpen => "bounty is not open",
            Self::BountyMustBeReserved => "bounty must be reserved before this action",
            Self::MissingContributor => "bounty has no contributor assigned",
            Self::MaintainerMismatch => "caller is not the bounty maintainer",
            Self::ContributorMismatch => "caller is not the assigned contributor",
            Self::BountyMustBeSubmitted => "bounty must be submitted before this action",
            Self::BountyAlreadyFinalized => "bounty has already been finalized",
            Self::BountyNotExpiredYet => "bounty deadline has not passed yet",
            Self::CannotExtendFinalizedBounty => "cannot extend a finalized bounty",
            Self::DeadlineMustAdvance => "new deadline must be after the current deadline",
            Self::BountyExpired => "bounty has expired",
            Self::BountyNotDisputed => "bounty is not currently disputed",
            Self::DisputeWindowNotMet => "dispute appeal window has not elapsed",
            Self::ConfigAlreadySet => "contract config has already been set",
            Self::ConfigNotSet => "contract config has not been set",
            Self::NoPendingResolution => "no dispute resolution is pending",
            Self::AppealWindowNotElapsed => "appeal window has not elapsed",
            Self::AppealWindowElapsed => "appeal window has already elapsed",
            Self::InvalidDecision => "invalid dispute decision",
            Self::NoPendingArbiter => "no arbiter rotation is pending",
            Self::TimelockNotElapsed => "arbiter rotation timelock has not elapsed",
        }
    }

    /// Returns the HTTP status code the backend API should use for this error.
    pub fn http_status(&self) -> u16 {
        match self {
            Self::AlreadyInitialized
            | Self::ConfigAlreadySet
            | Self::BountyAlreadyFinalized
            | Self::BountyNotDisputed
            | Self::DisputeWindowNotMet
            | Self::AppealWindowNotElapsed
            | Self::AppealWindowElapsed
            | Self::TimelockNotElapsed => 409,
            Self::NotAdmin
            | Self::NotArbiter
            | Self::MaintainerMismatch
            | Self::ContributorMismatch => 403,
            Self::ArbiterNotSet
            | Self::BountyNotFound
            | Self::ConfigNotSet
            | Self::NoPendingResolution
            | Self::NoPendingArbiter => 404,
            Self::ContractIsPaused => 503,
            _ => 400,
        }
    }
}

/// Panics with a formatted, taxonomy-aware contract error.
///
/// The panic message is prefixed with `CONTRACT_ERROR_<code>` so the backend
/// middleware can translate known errors into the shared HTTP error-code
/// taxonomy and fall back to a generic code for any unrecognized panic.
fn panic_error(err: ContractError) -> ! {
    panic!("CONTRACT_ERROR_{}: {}", err.code(), err.message())
}

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
    pub amount: i128,      // net payout after fee
    pub fee_amount: i128, // how much went to fee recipient
}

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

/// Contract error discriminant used by `panic_error` to produce stable,
/// indexer-friendly panic messages.  We stringify via Display (via
/// `panic!` with `"{e:?}"`) so the variant name appears verbatim in
/// the ledger entry and in any snapshot diffs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContractError {
    AlreadyInitialized,
    NotInitialized,
    NotAdmin,
    NotArbiter,
    ArbiterNotSet,
    NoPendingArbiter,
    TimelockNotElapsed,
    InvalidAmount,
    AmountTooSmall,
    DeadlineMustBeInTheFuture,
    DeadlineMustAdvance,
    FeeRecipientNotSet,
    TokenNotAllowed,
    DisputeWindowOverrideTooSmall,
    DisputeWindowOverrideTooLarge,
    BountyNotFound,
    BountyNotOpen,
    BountyMustBeReserved,
    BountyMustBeSubmitted,
    BountyNotExpiredYet,
    BountyExpired,
    BountyAlreadyFinalized,
    CannotExtendFinalizedBounty,
    MaintainerMismatch,
    ContributorMismatch,
    MissingContributor,
    DisputeWindowNotMet,
    ContractIsPaused,
    // ── Appended (see the note on `DataKey`): the variant name is part of the
    //    contract's observable panic message, so these are only ever added.
    /// The address has no bond, or less than `MinArbiterStake`.
    InsufficientArbiterStake,
    /// A bond is held in a different token than the one being paid in.
    StakeTokenMismatch,
    /// The address has never bonded, so there is nothing to slash.
    NoArbiterStake,
    /// The requested slash is larger than the bond held.
    SlashExceedsStake,
}

fn panic_error(e: ContractError) -> ! {
    panic!("{e:?}")
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
    pub fn initialize(env: Env, admin: Address, fee_recipient: Address, arbiter: Address, dispute_window: u64) {
        // Prevent re-initialization
        if env.storage().persistent().has(&DataKey::FeeRecipient) {
            panic!("already initialized");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Admin, &admin);
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
            panic_error(ContractError::InvalidAmount);
        }
        if new_min > MAX_BOUNTY_AMOUNT {
            panic_error(ContractError::InvalidAmount);
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
            panic_error(ContractError::ContractIsPaused);
        }

        let min_amount = Self::get_min_bounty_amount(env.clone());

        if amount <= 0 || amount > MAX_BOUNTY_AMOUNT {
            panic_error(ContractError::InvalidAmount);
        }
        if amount < min_amount {
            panic_error(ContractError::AmountTooSmall);
        }
        if deadline <= env.ledger().timestamp() {
            panic_error(ContractError::DeadlineMustBeInTheFuture);
        }
        //fee cannot exceed 100% (10000 bps)
        if protocol_fee_bps > 10_000 {
            panic!("fee exceeds 100%");
        }
        if protocol_fee_bps > 0 && !env.storage().persistent().has(&DataKey::FeeRecipient) {
            panic_error(ContractError::FeeRecipientNotSet);
        }
        if !is_token_allowed(&env, token.clone()) {
            panic_error(ContractError::TokenNotAllowed);
        }

        // Validate dispute window override if provided
        if let Some(override_value) = dispute_window_override {
            if override_value < MIN_DISPUTE_WINDOW_OVERRIDE {
                panic_error(ContractError::DisputeWindowOverrideTooSmall);
            }
            if override_value > MAX_DISPUTE_WINDOW_OVERRIDE {
                panic_error(ContractError::DisputeWindowOverrideTooLarge);
            }
        }

        let token_client = TokenClient::new(&env, &token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&maintainer, &contract_address, &amount);

        let mut next_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextBountyId)
            .unwrap_or(0);
        next_id += 1;

        let bounty = Bounty {
            maintainer: maintainer.clone(),
            contributor: None,
            token: token.clone(),
            amount,
            repo: repo.clone(),
            issue_number,
            title,
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
                maintainer,
                token,
                amount,
                repo,
                issue_number,
                protocol_fee_bps,
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
    /// * [`ContractError::BountyNotOpen`] - If the bounty's status is not [`BountyStatus::Open`] or has expired past deadline.
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
            panic_error(ContractError::ContractIsPaused);
        }

        let mut bounty = read_bounty(&env, bounty_id);
        expire_if_needed(&env, &mut bounty);

        if bounty.status != BountyStatus::Open {
            panic_error(ContractError::BountyNotOpen);
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
            panic_error(ContractError::MaintainerMismatch);
        }

        if bounty.status != BountyStatus::Reserved {
            panic_error(ContractError::BountyMustBeReserved);
        }

        let old_contributor = bounty
            .contributor
            .clone()
            .unwrap_or_else(|| panic_error(ContractError::MissingContributor));

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
    /// * [`ContractError::BountyMustBeReserved`] - If the bounty's status is not [`BountyStatus::Reserved`] (also triggered if `expire_if_needed` transitions an expired bounty to [`BountyStatus::Expired`]).
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

        if bounty.status != BountyStatus::Reserved {
            panic_error(ContractError::BountyMustBeReserved);
        }
        if bounty.contributor != Some(contributor.clone()) {
            panic_error(ContractError::ContributorMismatch);
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
    /// * Panics via `unwrap()` if the bounty lacks an assigned contributor (`bounty.contributor` is `None`).
    /// * Contract token client panics if token transfers to contributor or treasury fail.
    ///
    /// # Storage
    /// * **Read**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Reads the existing bounty state via `read_bounty`.
    ///   - [`DataKey::Treasury`] - Persistent storage lookup to obtain the protocol treasury address if fees apply.
    /// * **Write**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Updates `bounty.status` to [`BountyStatus::Released`] and records `bounty.released_at` timestamp.
    ///
    /// # Events
    /// * Emits `(symbol_short!("Bounty"), symbol_short!("Rel"))` with [`BountyReleased`] payload.
    pub fn release_bounty(env: Env, bounty_id: u64, maintainer: Address) {
        maintainer.require_auth();
        let mut bounty = read_bounty(&env, bounty_id);

        if bounty.maintainer != maintainer {
            panic_error(ContractError::MaintainerMismatch);
        }
        if bounty.status != BountyStatus::Submitted {
            panic_error(ContractError::BountyMustBeSubmitted);
        }

        let contributor = bounty.contributor.clone().unwrap();

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

        // Transfer net payout to contributor
        token_client.transfer(&contract_address, &contributor, &net_payout);

        // Transfer fee to recipient (only when fee is non-zero)
        if fee_amount > 0 {
            let fee_recipient: Address = env
                .storage()
                .persistent()
                .get(&DataKey::FeeRecipient)
                .unwrap_or_else(|| panic_error(ContractError::FeeRecipientNotSet));
            token_client.transfer(&contract_address, &fee_recipient, &fee_amount);
        }
        // ─────────────────────────────────────────────────────────────────

        // Atomically update FeeStats
        accumulate_fee_stats(&env, fee_amount);

        bounty.status = BountyStatus::Released;
        write_bounty(&env, bounty_id, &bounty);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Releas")),
            BountyReleased {
                bounty_id,
                contributor,
                amount: net_payout, // net amount after fee
                fee_amount,
            },
        );
    }

    /// Refunds the entire bounty amount back to the creator (maintainer) if expired and uncompleted.
    ///
    /// This function is part of the public contract ABI. A maintainer can reclaim their deposited
    /// tokens once the bounty deadline has passed, provided the bounty was not already released or refunded.
    /// Full original amount is returned without any protocol fees deducted.
    ///
    /// # Parameters
    /// * `env` - The Soroban contract environment.
    /// * `bounty_id` - Unique identifier (`u64`) of the bounty to refund.
    /// * `maintainer` - Address of the bounty creator requesting the refund.
    ///
    /// # Authorisation
    /// * Requires authorization from the specified `maintainer` (`maintainer.require_auth()`).
    ///
    /// # Errors & Panic Paths
    /// * [`ContractError::BountyNotFound`] - If no bounty exists with the given `bounty_id` (via `read_bounty`).
    /// * [`ContractError::MaintainerMismatch`] - If `maintainer` does not match the bounty's registered creator (`bounty.maintainer != maintainer`).
    /// * [`ContractError::BountyAlreadyFinalized`] - If the bounty status is already [`BountyStatus::Released`] or [`BountyStatus::Refunded`].
    /// * [`ContractError::BountyNotExpiredYet`] - If the current ledger timestamp is less than or equal to `bounty.deadline` (and `bounty.deadline != 0`).
    ///
    /// # Storage
    /// * **Read**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Reads the existing bounty state via `read_bounty`.
    /// * **Write**:
    ///   - [`DataKey::Bounty(bounty_id)`] - Updates `bounty.status` to [`BountyStatus::Refunded`] via `write_bounty`.
    ///
    /// # Events
    /// * Emits `(symbol_short!("Bounty"), symbol_short!("Refund"))` with [`BountyRefunded`] payload.
    pub fn refund_bounty(env: Env, bounty_id: u64, maintainer: Address) {
        maintainer.require_auth();
        let mut bounty = read_bounty(&env, bounty_id);

        if bounty.maintainer != maintainer {
            panic_error(ContractError::MaintainerMismatch);
        }

        if bounty.status == BountyStatus::Released || bounty.status == BountyStatus::Refunded {
            panic_error(ContractError::BountyAlreadyFinalized);
        }

        let now = env.ledger().timestamp();
        if now <= bounty.deadline && bounty.deadline != 0 {
            panic_error(ContractError::BountyNotExpiredYet);
        }

        let token_client = TokenClient::new(&env, &bounty.token);
        let contract_address = env.current_contract_address();
        // Refund returns the FULL original amount there is no fee on refunds
        token_client.transfer(&contract_address, &maintainer, &bounty.amount);

        bounty.status = BountyStatus::Refunded;
        write_bounty(&env, bounty_id, &bounty);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Refund")),
            BountyRefunded {
                bounty_id,
                maintainer,
                amount: bounty.amount,
            },
        );
    }

    pub fn cancel_bounty(env: Env, bounty_id: u64, maintainer: Address) {
        maintainer.require_auth();
        let mut bounty = read_bounty(&env, bounty_id);
        expire_if_needed(&env, &mut bounty);

        if bounty.maintainer != maintainer {
            panic_error(ContractError::MaintainerMismatch);
        }
        if bounty.status != BountyStatus::Open {
            panic_error(ContractError::BountyNotOpen);
        }

        let token_client = TokenClient::new(&env, &bounty.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &maintainer, &bounty.amount);

        bounty.status = BountyStatus::Refunded;
        write_bounty(&env, bounty_id, &bounty);

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
            panic_error(ContractError::MaintainerMismatch);
        }

        if bounty.status == BountyStatus::Released
            || bounty.status == BountyStatus::Refunded
            || bounty.status == BountyStatus::Expired
        {
            panic_error(ContractError::CannotExtendFinalizedBounty);
        }

        if new_deadline <= bounty.deadline {
            panic_error(ContractError::DeadlineMustAdvance);
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
    /// * [`ContractError::BountyMustBeSubmitted`] - If the bounty's current status is not [`BountyStatus::Submitted`].
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
    /// * Emits `(symbol_short!("Bounty"), symbol_short!("Dispt"))` with [`BountyDisputed`] payload.
    pub fn dispute_bounty(env: Env, bounty_id: u64, arbiter: Address) {
        let mut bounty = read_bounty(&env, bounty_id);

        if env.ledger().timestamp() > bounty.deadline {
            panic_error(ContractError::BountyExpired);
        }

        let contributor = bounty
            .contributor
            .clone()
            .unwrap_or_else(|| panic_error(ContractError::MissingContributor));

        contributor.require_auth();

        if bounty.status != BountyStatus::Submitted {
            panic_error(ContractError::BountyMustBeSubmitted);
        }

        let stored_arbiter: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Arbiter)
            .unwrap_or_else(|| panic_error(ContractError::ArbiterNotSet));

        if arbiter != stored_arbiter {
            panic_error(ContractError::NotArbiter);
        }

        bounty.status = BountyStatus::Disputed;
        bounty.dispute_raised_at = env.ledger().timestamp();
        write_bounty(&env, bounty_id, &bounty);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Dispt")),
            BountyDisputed {
                bounty_id,
                contributor,
                arbiter,
            },
        );
    }

    pub fn resolve_dispute(env: Env, bounty_id: u64, release: bool) {
        let arbiter: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Arbiter)
            .unwrap_or_else(|| panic_error(ContractError::ArbiterNotSet));

        arbiter.require_auth();

        let mut bounty = read_bounty(&env, bounty_id);

        if bounty.status != BountyStatus::Disputed {
            panic!("bounty not disputed");
        }

        // Use per-bounty override if set, otherwise fall back to global default
        let effective_dispute_window: u64 = bounty
            .dispute_window_override
            .unwrap_or_else(|| {
                env.storage()
                    .persistent()
                    .get(&DataKey::DisputeWindow)
                    .unwrap_or(0)
            });

        if env.ledger().timestamp() < bounty.dispute_raised_at + effective_dispute_window {
            panic_error(ContractError::DisputeWindowNotMet);
        }

        let token_client = TokenClient::new(&env, &bounty.token);
        let contract_address = env.current_contract_address();

        if release {
            let contributor = bounty
                .contributor
                .clone()
                .unwrap_or_else(|| panic_error(ContractError::MissingContributor));

            let fee_amount: i128 = if bounty.protocol_fee_bps == 0 {
                0
            } else {
                (bounty.amount * bounty.protocol_fee_bps as i128) / 10_000
            };

            let net_payout = bounty.amount - fee_amount;

            token_client.transfer(&contract_address, &contributor, &net_payout);

            if fee_amount > 0 {
                let fee_recipient: Address = env
                    .storage()
                    .persistent()
                    .get(&DataKey::FeeRecipient)
                    .unwrap_or_else(|| panic_error(ContractError::FeeRecipientNotSet));
                token_client.transfer(&contract_address, &fee_recipient, &fee_amount);
            }

            // Atomically update FeeStats for the dispute-release path
            accumulate_fee_stats(&env, fee_amount);

            bounty.status = BountyStatus::Released;
        } else {
            token_client.transfer(&contract_address, &bounty.maintainer, &bounty.amount);
            bounty.status = BountyStatus::Refunded;
        }

        write_bounty(&env, bounty_id, &bounty);

        env.events().publish(
            (symbol_short!("Bounty"), symbol_short!("Reslv")),
            BountyResolved {
                bounty_id,
                arbiter,
                release,
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
        // For simplicity, any caller can resolve; in production enforce arbiter auth.
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
        let cfg: Config = env.storage().persistent().get(&DataKey::Config).expect("config not set");
        let now = env.ledger().timestamp();
        if now < pending.timestamp + cfg.appeal_window {
            panic!("appeal window not elapsed");
        }
        // Load bounty
        let mut bounty = read_bounty(&env, bounty_id);
        // Resolve based on decision
        match pending.decision {
            DisputeDecision::Release => {
                // transfer to contributor
                let contributor = bounty
                    .contributor
                    .clone()
                    .unwrap_or_else(|| panic!("missing contributor"));
                let token_client = TokenClient::new(&env, &bounty.token);
                token_client.transfer(&env.current_contract_address(), &contributor, &bounty.amount);
                bounty.status = BountyStatus::Released;
                write_bounty(&env, bounty_id, &bounty);
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
                token_client.transfer(&env.current_contract_address(), &maintainer, &bounty.amount);
                bounty.status = BountyStatus::Refunded;
                write_bounty(&env, bounty_id, &bounty);
                env.events().publish(
                    (symbol_short!("Bounty"), symbol_short!("Refund")),
                    BountyRefunded {
                        bounty_id,
                        maintainer,
                        amount: bounty.amount,
                    },
                );
            }
        }
        // Remove pending
        env.storage().persistent().remove(&DataKey::PendingResolution(bounty_id));
    }

    pub fn appeal(env: Env, bounty_id: u64) {
        let pending_opt: Option<PendingResolution> = env
            .storage()
            .persistent()
            .get(&DataKey::PendingResolution(bounty_id));
        let pending = pending_opt.expect("no pending resolution");
        let cfg: Config = env.storage().persistent().get(&DataKey::Config).expect("config not set");
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
        env.storage().persistent().remove(&DataKey::PendingResolution(bounty_id));
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
    pub fn get_bounties_by_contributor(env: Env, contributor: Address, start: u64, limit: u32) -> Vec<Bounty> {
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
            panic_error(ContractError::InvalidAmount);
        }

        let key = DataKey::ArbiterStake(arbiter.clone());
        let existing: Option<ArbiterStake> = env.storage().persistent().get(&key);

        let total = match &existing {
            Some(stake) => {
                if stake.token != token {
                    panic_error(ContractError::StakeTokenMismatch);
                }
                stake.amount
                    .checked_add(amount)
                    .unwrap_or_else(|| panic_error(ContractError::InvalidAmount))
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
            .unwrap_or_else(|| panic_error(ContractError::ArbiterNotSet))
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
            panic_error(ContractError::InvalidAmount);
        }
        if new_min > MAX_BOUNTY_AMOUNT {
            panic_error(ContractError::InvalidAmount);
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
            .unwrap_or_else(|| panic_error(ContractError::NotAdmin));
        admin.require_auth();

        if amount <= 0 {
            panic_error(ContractError::InvalidAmount);
        }

        let key = DataKey::ArbiterStake(arbiter.clone());
        let mut stake: ArbiterStake = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_error(ContractError::NoArbiterStake));

        if amount > stake.amount {
            panic_error(ContractError::SlashExceedsStake);
        }

        // The treasury is the fee recipient already configured on this contract;
        // protocol funds have one destination rather than two.
        let treasury: Address = env
            .storage()
            .persistent()
            .get(&DataKey::FeeRecipient)
            .unwrap_or_else(|| panic_error(ContractError::FeeRecipientNotSet));

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
            .unwrap_or_else(|| panic_error(ContractError::NotAdmin));
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
            .unwrap_or_else(|| panic_error(ContractError::NotAdmin));
        admin.require_auth();

        let pending_arbiter: Address = env
            .storage()
            .persistent()
            .get(&DataKey::PendingArbiter)
            .unwrap_or_else(|| panic_error(ContractError::NoPendingArbiter));

        let timelock: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ArbiterRotationTimelock)
            .unwrap_or_else(|| panic_error(ContractError::NoPendingArbiter));

        if env.ledger().timestamp() < timelock {
            panic_error(ContractError::TimelockNotElapsed);
        }

        // Re-checked here: a slash during the timelock must not let an
        // under-bonded address into office through the back door.
        require_min_arbiter_stake(&env, &pending_arbiter);

        let old_arbiter: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Arbiter)
            .unwrap();

        env.storage().persistent().set(&DataKey::Arbiter, &pending_arbiter);
        env.storage().persistent().remove(&DataKey::PendingArbiter);
        env.storage().persistent().remove(&DataKey::ArbiterRotationTimelock);

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
            .unwrap_or_else(|| panic_error(ContractError::NotAdmin));
        if admin != stored_admin {
            panic_error(ContractError::NotAdmin);
        }
        admin.require_auth();
        let mut config = get_allowlist_config(&env);
        config.enabled = enabled;
        env.storage().instance().set(&DataKey::AllowlistConfig, &config);
    }

    /// Admin: add a token to the allowlist
    pub fn add_allowed_token(env: Env, admin: Address, token: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_error(ContractError::NotAdmin));
        if admin != stored_admin {
            panic_error(ContractError::NotAdmin);
        }
        admin.require_auth();
        let mut config = get_allowlist_config(&env);
        if !config.allowed_tokens.contains(&token) {
            config.allowed_tokens.push_back(token.clone());
            env.storage().instance().set(&DataKey::AllowlistConfig, &config);
            env.events().publish(
                (symbol_short!("allowlist"), symbol_short!("add")),
                token,
            );
        }
    }

    /// Admin: remove a token from the allowlist
    pub fn remove_allowed_token(env: Env, admin: Address, token: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_error(ContractError::NotAdmin));
        if admin != stored_admin {
            panic_error(ContractError::NotAdmin);
        }
        admin.require_auth();
        let mut config = get_allowlist_config(&env);
        
        if let Some(index) = config.allowed_tokens.first_index_of(&token) {
            config.allowed_tokens.remove(index);
            env.storage().instance().set(&DataKey::AllowlistConfig, &config);
            env.events().publish(
                (symbol_short!("allowlist"), symbol_short!("remove")),
                token,
            );
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
            .unwrap_or_else(|| panic_error(ContractError::NotAdmin));
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
}

// ─── Helper Functions ────────────────────────────────────────────────────────

fn read_bounty(env: &Env, bounty_id: u64) -> Bounty {
    env.storage()
        .persistent()
        .get(&DataKey::Bounty(bounty_id))
        .unwrap_or_else(|| panic_error(ContractError::BountyNotFound))
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
        panic_error(ContractError::InsufficientArbiterStake);
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

    stats.total_collected += fee_amount;
    stats.bounty_count += 1;

    env.storage().persistent().set(&DataKey::FeeStats, &stats);

}