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

    pub fn resolve_dispute(env: Env, bounty_id: u64, decision_u8: u8) {
        // For simplicity, any caller can resolve; in production enforce arbiter auth.
        let decision = match decision_u8 {
            0 => DisputeDecision::Release,
            1 => DisputeDecision::Refund,
            _ => panic!("invalid decision"),
        };
        let timestamp = env.ledger().timestamp();
        let pending = PendingResolution { decision, timestamp };
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
    pub fn set_arbiter(env: Env, new_arbiter: Address) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_error(ContractError::NotAdmin));
        admin.require_auth();

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

        let previous_wasm_hash: BytesN<32> = env
            .deployer()
            .get_contract_info(&env.current_contract_address())
            .map(|info| info.wasm_hash)
            .unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32]));

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

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