#![allow(deprecated)]
#![allow(unused_imports)]
#![allow(clippy::too_many_arguments)]

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    token::Client as TokenClient, Address, Env, String, Vec,
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

pub const MAX_BOUNTY_AMOUNT: i128 = 1_000_000_000_000_000;

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
    NextBountyId,
    Bounty(u64),
    FeeRecipient,
    Admin,
    Arbiter,
    DisputeWindow,
    MinBountyAmount,
    Paused,
    Config,
    PendingResolution(u64),
    FeeStats,
    PendingArbiter,
    ArbiterRotationTimelock,
    AllowlistConfig,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    InvalidAmount = 1,
    ContractIsPaused = 2,
    AmountTooSmall = 3,
    DeadlineMustBeInTheFuture = 4,
    FeeRecipientNotSet = 5,
    TokenNotAllowed = 6,
    DisputeWindowOverrideTooSmall = 7,
    DisputeWindowOverrideTooLarge = 8,
    BountyNotOpen = 9,
    MaintainerMismatch = 10,
    BountyMustBeReserved = 11,
    MissingContributor = 12,
    ContributorMismatch = 13,
    BountyMustBeSubmitted = 14,
    BountyAlreadyFinalized = 15,
    BountyNotExpiredYet = 16,
    CannotExtendFinalizedBounty = 17,
    DeadlineMustAdvance = 18,
    BountyExpired = 19,
    ArbiterNotSet = 20,
    NotArbiter = 21,
    DisputeWindowNotMet = 22,
    NotAdmin = 23,
    NoPendingArbiter = 24,
    TimelockNotElapsed = 25,
    BountyNotFound = 26,
}

fn panic_error(error: ContractError) -> ! {
    panic!("{:?}", error);
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
pub struct BountyCanceled {
    pub bounty_id: u64,
    pub maintainer: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyDeadlineExtended {
    pub bounty_id: u64,
    pub new_deadline: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyDisputed {
    pub bounty_id: u64,
    pub contributor: Address,
    pub arbiter: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyResolved {
    pub bounty_id: u64,
    pub arbiter: Address,
    pub release: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DisputeAppealed {
    pub bounty_id: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbiterRotationProposed {
    pub new_arbiter: Address,
    pub unlock_time: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbiterRotationConfirmed {
    pub old_arbiter: Address,
    pub new_arbiter: Address,
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