#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short,
    token::Client as TokenClient, Address, Env, String, Vec,
};

// ─── Contract Version ─────────────────────────────────────────────────────────
/// Semver string pulled from Cargo.toml at compile time.
pub const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

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
    NextBountyId,
    Bounty(u64),
    FeeRecipient,
    Arbiter,
    DisputeWindow,
    /// Accumulated protocol fee statistics.
    FeeStats,
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

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BountyRefunded {
    pub bounty_id: u64,
    pub maintainer: Address,
    pub amount: i128,
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
pub struct BountyDeadlineExtended {
    pub bounty_id: u64,
    pub new_deadline: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContractError {
    InvalidAmount,
    DeadlineMustBeInTheFuture,
    BountyNotOpen,
    BountyMustBeReserved,
    ContributorMismatch,
    MaintainerMismatch,
    BountyMustBeSubmitted,
    MissingContributor,
    BountyAlreadyFinalized,
    BountyNotExpiredYet,
    BountyExpired,
    DeadlineMustAdvance,
    CannotExtendFinalizedBounty,
    BountyNotFound,
    NotArbiter,
    DisputeWindowNotMet,
}

/// Maximum allowed bounty amount: 10 billion XLM expressed in stroops
/// (1 XLM = 10_000_000 stroops, so 10_000_000_000 XLM × 10_000_000 = 10^17 stroops).
///
/// Rationale: Without an upper bound an attacker could create a bounty with
/// i128::MAX.  Fee math performs  `amount * protocol_fee_bps / 10_000`, which
/// overflows for values close to i128::MAX (≈ 1.7 × 10^38).  Capping at 10 B
/// XLM in stroops (10^17) leaves more than 20 orders-of-magnitude of headroom
/// below the i128 ceiling, making overflow arithmetically impossible while
/// still allowing any realistic on-chain bounty value.
const MAX_BOUNTY_AMOUNT: i128 = 10_000_000_000_0000000; // 10 B XLM in stroops

fn panic_error(error: ContractError) -> ! {
    panic!("{:?}", error);
}

#[contract]
pub struct StellarBountyBoardContract;

#[contractimpl]
impl StellarBountyBoardContract {
    // ─── Version ─────────────────────────────────────────────────────────────
    /// Returns the contract version as a semver string (e.g. "0.1.0").
    pub fn get_version(_env: Env) -> String {
        // We use _env because String::from_str needs it, but in future
        // Soroban SDK versions this may be optional for static strings.
        String::from_str(&_env, CONTRACT_VERSION)
    }
    
    pub fn initialize(env: Env, fee_recipient: Address, arbiter: Address, dispute_window: u64) {
        // Prevent re-initialization
        if env.storage().persistent().has(&DataKey::FeeRecipient) {
            panic!("already initialized");
        }
        env.storage()
            .persistent()
            .set(&DataKey::FeeRecipient, &fee_recipient);
        env.storage().persistent().set(&DataKey::Arbiter, &arbiter);
        env.storage()
            .persistent()
            .set(&DataKey::DisputeWindow, &dispute_window);
    }

    pub fn get_fee_recipient(env: Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::FeeRecipient)
            .unwrap_or_else(|| panic!("not initialized"))
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
    ) -> u64 {
        maintainer.require_auth();

        if amount <= 0 || amount > MAX_BOUNTY_AMOUNT {
            panic_error(ContractError::InvalidAmount);
        }
        if deadline <= env.ledger().timestamp() {
            panic_error(ContractError::DeadlineMustBeInTheFuture);
        }
        //fee cannot exceed 100% (10000 bps)
        if protocol_fee_bps > 10_000 {
            panic!("fee exceeds 100%");
        }
        if protocol_fee_bps > 0 && !env.storage().persistent().has(&DataKey::FeeRecipient) {
            panic!("fee recipient not set");
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

        // ── Fee calculation ──────────────────────────────────────────────
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
                .unwrap_or_else(|| panic!("fee recipient not set"));
            token_client.transfer(&contract_address, &fee_recipient, &fee_amount);
        }
        // ────────────────────────────────────────────────────────────────

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
            .unwrap_or_else(|| panic!("arbiter not set"));

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
            .unwrap_or_else(|| panic!("arbiter not set"));

        arbiter.require_auth();

        let mut bounty = read_bounty(&env, bounty_id);

        if bounty.status != BountyStatus::Disputed {
            panic!("bounty not disputed");
        }

        let dispute_window: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::DisputeWindow)
            .unwrap_or(0);

        if env.ledger().timestamp() < bounty.dispute_raised_at + dispute_window {
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
                    .unwrap_or_else(|| panic!("fee recipient not set"));
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
} main
}

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
