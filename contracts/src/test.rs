#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
    Address, Env, IntoVal, String, Symbol,
};

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReentryAction {
    Release,
    Refund,
    ResolveRelease,
    ResolveRefund,
}

#[contracttype]
#[derive(Clone)]
struct ReentryConfig {
    target: Address,
    bounty_id: u64,
    maintainer: Address,
    action: ReentryAction,
}

#[contracttype]
enum MaliciousTokenKey {
    Balance(Address),
    ReentryConfig,
    AttackAttempted,
    AttackCount,
    OutboundTransferCount,
}

#[contract]
struct MaliciousTokenContract;

#[contractimpl]
impl MaliciousTokenContract {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = MaliciousTokenKey::Balance(to);
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(balance + amount));
    }

    pub fn configure_attack(
        env: Env,
        target: Address,
        bounty_id: u64,
        maintainer: Address,
        action: ReentryAction,
    ) {
        env.storage().persistent().set(
            &MaliciousTokenKey::ReentryConfig,
            &ReentryConfig {
                target,
                bounty_id,
                maintainer,
                action,
            },
        );
        env.storage()
            .persistent()
            .set(&MaliciousTokenKey::AttackAttempted, &false);
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        if amount < 0 {
            panic!("negative transfer");
        }

        let from_key = MaliciousTokenKey::Balance(from.clone());
        let to_key = MaliciousTokenKey::Balance(to.clone());
        let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        if from_balance < amount {
            panic!("insufficient balance");
        }

        let config: Option<ReentryConfig> = env
            .storage()
            .persistent()
            .get(&MaliciousTokenKey::ReentryConfig);
        let attempted: bool = env
            .storage()
            .persistent()
            .get(&MaliciousTokenKey::AttackAttempted)
            .unwrap_or(false);

        if let Some(config) = config {
            if from == config.target && !attempted {
                env.storage()
                    .persistent()
                    .set(&MaliciousTokenKey::AttackAttempted, &true);

                let count: u32 = env
                    .storage()
                    .persistent()
                    .get(&MaliciousTokenKey::AttackCount)
                    .unwrap_or(0);
                env.storage()
                    .persistent()
                    .set(&MaliciousTokenKey::AttackCount, &(count + 1));

                // Soroban cross-contract calls are synchronous, and the host rejects
                // direct re-entry into a contract already on the invocation stack.
                // try_invoke_contract captures that host error so this malicious token
                // can finish the outer transfer. The escrow still writes its terminal
                // status before this call as checks-effects-interactions defense-in-depth.
                match config.action {
                    ReentryAction::Release => {
                        let _ = env.try_invoke_contract::<(), soroban_sdk::Error>(
                            &config.target,
                            &Symbol::new(&env, "release_bounty"),
                            (config.bounty_id, config.maintainer).into_val(&env),
                        );
                    }
                    ReentryAction::Refund => {
                        let _ = env.try_invoke_contract::<(), soroban_sdk::Error>(
                            &config.target,
                            &Symbol::new(&env, "refund_bounty"),
                            (config.bounty_id, config.maintainer).into_val(&env),
                        );
                    }
                    ReentryAction::ResolveRelease => {
                        let _ = env.try_invoke_contract::<(), soroban_sdk::Error>(
                            &config.target,
                            &Symbol::new(&env, "resolve_dispute"),
                            (config.bounty_id, true).into_val(&env),
                        );
                    }
                    ReentryAction::ResolveRefund => {
                        let _ = env.try_invoke_contract::<(), soroban_sdk::Error>(
                            &config.target,
                            &Symbol::new(&env, "resolve_dispute"),
                            (config.bounty_id, false).into_val(&env),
                        );
                    }
                }
            }

            if from == config.target {
                let count: u32 = env
                    .storage()
                    .persistent()
                    .get(&MaliciousTokenKey::OutboundTransferCount)
                    .unwrap_or(0);
                env.storage()
                    .persistent()
                    .set(&MaliciousTokenKey::OutboundTransferCount, &(count + 1));
            }
        }

        let to_balance: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&from_key, &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&to_key, &(to_balance + amount));
    }

    pub fn balance(env: Env, owner: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&MaliciousTokenKey::Balance(owner))
            .unwrap_or(0)
    }

    pub fn attack_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&MaliciousTokenKey::AttackCount)
            .unwrap_or(0)
    }

    pub fn outbound_transfer_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&MaliciousTokenKey::OutboundTransferCount)
            .unwrap_or(0)
    }
}

// ─── Version Tests ──────────────────────────────────────────────────────────

#[test]
fn test_get_version_matches_cargo_toml() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StellarBountyBoardContract);
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let version = client.get_version();
    let expected = env!("CARGO_PKG_VERSION");

    assert_eq!(
        version,
        String::from_str(&env, expected),
        "get_version() should return the semver from Cargo.toml"
    );
}

#[test]
fn test_contract_version_constant() {
    // Direct assertion on the compile-time constant
    assert_eq!(CONTRACT_VERSION, env!("CARGO_PKG_VERSION"));
    assert!(!CONTRACT_VERSION.is_empty());
    assert!(CONTRACT_VERSION.contains('.')); // basic semver check
}

// ─── Shared setup ────────────────────────────────────────────────────────────
fn setup_test(
    env: &Env,
) -> (
    StellarBountyBoardContractClient<'static>,
    Address, // maintainer
    Address, // contributor
    Address, // token_id
    Address, // fee_recipient
    Address, // arbiter
) {
    let contract_id = env.register_contract(None, StellarBountyBoardContract);
    let client = StellarBountyBoardContractClient::new(env, &contract_id);

    let maintainer = Address::generate(env);
    let contributor = Address::generate(env);
    let fee_recipient = Address::generate(env);
    let arbiter = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);

    // Initialize contract with a fee recipient, arbiter, and 10min dispute window
    client.initialize(&fee_recipient, &arbiter, &600);

    (
        client,
        maintainer,
        contributor,
        token_id.address(),
        fee_recipient,
        arbiter,
    )
}

fn setup_malicious_test(
    env: &Env,
) -> (
    StellarBountyBoardContractClient<'static>,
    MaliciousTokenContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
) {
    let contract_id = env.register_contract(None, StellarBountyBoardContract);
    let client = StellarBountyBoardContractClient::new(env, &contract_id);
    let token_id = env.register_contract(None, MaliciousTokenContract);
    let token = MaliciousTokenContractClient::new(env, &token_id);
    let maintainer = Address::generate(env);
    let contributor = Address::generate(env);
    let fee_recipient = Address::generate(env);
    let arbiter = Address::generate(env);

    client.initialize(&fee_recipient, &arbiter, &600);
    (
        client,
        token,
        maintainer,
        contributor,
        fee_recipient,
        arbiter,
    )
}

fn create_bounty_with_state(
    env: &Env,
    client: &StellarBountyBoardContractClient<'static>,
    maintainer: Address,
    contributor: Address,
    token_id: Address,
    status: BountyStatus,
) -> u64 {
    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
    );

    match status {
        BountyStatus::Open => bounty_id,
        BountyStatus::Reserved => {
            client.reserve_bounty(&bounty_id, &contributor);
            bounty_id
        }
        BountyStatus::Submitted => {
            client.reserve_bounty(&bounty_id, &contributor);
            client.submit_bounty(&bounty_id, &contributor);
            bounty_id
        }
        BountyStatus::Released => {
            client.reserve_bounty(&bounty_id, &contributor);
            client.submit_bounty(&bounty_id, &contributor);
            client.release_bounty(&bounty_id, &maintainer);
            bounty_id
        }
        BountyStatus::Refunded => {
            client.reserve_bounty(&bounty_id, &contributor);
            env.ledger().set_timestamp(deadline + 1);
            client.refund_bounty(&bounty_id, &maintainer);
            bounty_id
        }
        BountyStatus::Expired => {
            env.ledger().set_timestamp(deadline + 1);
            bounty_id
        }
        BountyStatus::Disputed => {
            client.reserve_bounty(&bounty_id, &contributor);
            client.submit_bounty(&bounty_id, &contributor);
            // This helper doesn't put it in disputed state directly,
            // but we can manually do it if needed in specific tests.
            bounty_id
        }
    }
}

macro_rules! invalid_transition_test {
    ($name:ident, $status:expr, $expected:expr, $action:block) => {
        #[test]
        #[should_panic(expected = $expected)]
        fn $name() {
            let env = Env::default();
            env.mock_all_auths();
            let (client, maintainer, contributor, token_id, _, _) = setup_test(&env);
            let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
            token_admin.mint(&maintainer, &1000);

            let bounty_id = create_bounty_with_state(
                &env,
                &client,
                maintainer.clone(),
                contributor.clone(),
                token_id.clone(),
                $status,
            );
            let action = $action;
            action(&client, bounty_id, maintainer, contributor);
        }
    };
}

#[test]
fn test_create_bounty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _contributor, token_id, _fee_recipient, _arbiter) = setup_test(&env);
    let token = TokenClient::new(&env, &token_id);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);

    token_admin.mint(&maintainer, &1000);

    let repo = String::from_str(&env, "ritik4ever/stellar-bounty-board");
    let title = String::from_str(&env, "Fix bug");
    let deadline = env.ledger().timestamp() + 1000;
    let amount = 500i128;
    let issue_number = 1u32;

    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &amount,
        &repo,
        &issue_number,
        &title,
        &deadline,
        &0u32, // zero fee — no behavior change
    );

    assert_eq!(bounty_id, 1);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.maintainer, maintainer);
    assert_eq!(bounty.amount, amount);
    assert_eq!(bounty.status, BountyStatus::Open);
    assert_eq!(bounty.protocol_fee_bps, 0);
    assert_eq!(token.balance(&client.address), amount);
    assert_eq!(token.balance(&maintainer), 500);
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn test_create_bounty_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, maintainer, _, token_id, _, _) = setup_test(&env);

    client.create_bounty(
        &maintainer,
        &token_id,
        &-1,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
    );
}

#[test]
#[should_panic(expected = "DeadlineMustBeInTheFuture")]
fn test_create_bounty_past_deadline() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, maintainer, _, token_id, _, _) = setup_test(&env);

    client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &env.ledger().timestamp(),
        &0u32,
    );
}

#[test]
fn test_create_bounty_fee_bps_boundary_math_and_fee_stats() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _, token_id, fee_recipient, _) = setup_test(&env);
    let token = TokenClient::new(&env, &token_id);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &40_000);

    let amount = 10_000i128;
    let cases = [0u32, 1, 9_999, 10_000];
    let mut expected_total_fees = 0i128;

    for (index, fee_bps) in cases.iter().enumerate() {
        let contributor = Address::generate(&env);
        let bounty_id = client.create_bounty(
            &maintainer,
            &token_id,
            &amount,
            &String::from_str(&env, "repo"),
            &((index + 1) as u32),
            &String::from_str(&env, "fee boundary"),
            &(env.ledger().timestamp() + 1_000),
            fee_bps,
        );

        client.reserve_bounty(&bounty_id, &contributor);
        client.submit_bounty(&bounty_id, &contributor);
        client.release_bounty(&bounty_id, &maintainer);

        let expected_fee = (amount * *fee_bps as i128) / 10_000;
        expected_total_fees += expected_fee;
        assert_eq!(token.balance(&contributor), amount - expected_fee);
        assert_eq!(token.balance(&fee_recipient), expected_total_fees);
        assert_eq!(token.balance(&client.address), 0);

        let stats = client.get_fee_stats();
        assert_eq!(stats.total_collected, expected_total_fees);
        assert_eq!(stats.bounty_count, (index + 1) as u64);
    }

    assert_eq!(expected_total_fees, 20_000);
}

#[test]
fn test_create_bounty_fee_bps_above_10000_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _, token_id, _, _) = setup_test(&env);
    let invalid_cases = [10_001u32, 10_002, u32::MAX];

    for fee_bps in invalid_cases {
        let result = client.try_create_bounty(
            &maintainer,
            &token_id,
            &10_000,
            &String::from_str(&env, "repo"),
            &fee_bps,
            &String::from_str(&env, "invalid fee"),
            &(env.ledger().timestamp() + 1_000),
            &fee_bps,
        );
        assert!(result.is_err(), "fee_bps {fee_bps} should be rejected");
    }

    assert_eq!(client.get_next_bounty_id(), 0);
}

#[test]
#[should_panic(expected = "InvalidFeeBps")]
fn test_create_bounty_fee_bps_10001_uses_invalid_fee_error_variant() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, maintainer, _, token_id, _, _) = setup_test(&env);

    client.create_bounty(
        &maintainer,
        &token_id,
        &10_000,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "invalid fee"),
        &(env.ledger().timestamp() + 1_000),
        &10_001,
    );
}

#[test]
fn test_release_bounty_reentrancy_does_not_double_pay() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (client, token, maintainer, contributor, _, _) = setup_malicious_test(&env);
    token.mint(&maintainer, &1_000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token.address,
        &1_000,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "release reentry"),
        &(env.ledger().timestamp() + 1_000),
        &0,
    );
    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    token.configure_attack(
        &client.address,
        &bounty_id,
        &maintainer,
        &ReentryAction::Release,
    );

    client.release_bounty(&bounty_id, &maintainer);

    assert_eq!(client.get_bounty(&bounty_id).status, BountyStatus::Released);
    assert_eq!(token.balance(&contributor), 1_000);
    assert_eq!(token.balance(&client.address), 0);
    assert_eq!(token.attack_count(), 1);
    assert_eq!(token.outbound_transfer_count(), 1);
    assert!(client.try_release_bounty(&bounty_id, &maintainer).is_err());
    assert_eq!(token.balance(&contributor), 1_000);
}

#[test]
fn test_refund_bounty_reentrancy_does_not_double_refund() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (client, token, maintainer, _, _, _) = setup_malicious_test(&env);
    token.mint(&maintainer, &1_000);

    let deadline = env.ledger().timestamp() + 1_000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token.address,
        &1_000,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "refund reentry"),
        &deadline,
        &0,
    );
    env.ledger().set_timestamp(deadline + 1);
    token.configure_attack(
        &client.address,
        &bounty_id,
        &maintainer,
        &ReentryAction::Refund,
    );

    client.refund_bounty(&bounty_id, &maintainer);

    assert_eq!(client.get_bounty(&bounty_id).status, BountyStatus::Refunded);
    assert_eq!(token.balance(&maintainer), 1_000);
    assert_eq!(token.balance(&client.address), 0);
    assert_eq!(token.attack_count(), 1);
    assert_eq!(token.outbound_transfer_count(), 1);
    assert!(client.try_refund_bounty(&bounty_id, &maintainer).is_err());
    assert_eq!(token.balance(&maintainer), 1_000);
}

#[test]
fn test_resolve_dispute_release_reentrancy_does_not_double_pay() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (client, token, maintainer, contributor, _, arbiter) = setup_malicious_test(&env);
    token.mint(&maintainer, &1_000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token.address,
        &1_000,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "resolve release reentry"),
        &(env.ledger().timestamp() + 2_000),
        &0,
    );
    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.dispute_bounty(&bounty_id, &arbiter);
    env.ledger().set_timestamp(env.ledger().timestamp() + 600);
    token.configure_attack(
        &client.address,
        &bounty_id,
        &maintainer,
        &ReentryAction::ResolveRelease,
    );

    client.resolve_dispute(&bounty_id, &true);

    assert_eq!(client.get_bounty(&bounty_id).status, BountyStatus::Released);
    assert_eq!(token.balance(&contributor), 1_000);
    assert_eq!(token.balance(&client.address), 0);
    assert_eq!(token.attack_count(), 1);
    assert_eq!(token.outbound_transfer_count(), 1);
    assert!(client.try_resolve_dispute(&bounty_id, &true).is_err());
    assert_eq!(token.balance(&contributor), 1_000);
}

#[test]
fn test_resolve_dispute_refund_reentrancy_does_not_double_refund() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let (client, token, maintainer, contributor, _, arbiter) = setup_malicious_test(&env);
    token.mint(&maintainer, &1_000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token.address,
        &1_000,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "resolve refund reentry"),
        &(env.ledger().timestamp() + 2_000),
        &0,
    );
    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.dispute_bounty(&bounty_id, &arbiter);
    env.ledger().set_timestamp(env.ledger().timestamp() + 600);
    token.configure_attack(
        &client.address,
        &bounty_id,
        &maintainer,
        &ReentryAction::ResolveRefund,
    );

    client.resolve_dispute(&bounty_id, &false);

    assert_eq!(client.get_bounty(&bounty_id).status, BountyStatus::Refunded);
    assert_eq!(token.balance(&maintainer), 1_000);
    assert_eq!(token.balance(&client.address), 0);
    assert_eq!(token.attack_count(), 1);
    assert_eq!(token.outbound_transfer_count(), 1);
    assert!(client.try_resolve_dispute(&bounty_id, &false).is_err());
    assert_eq!(token.balance(&maintainer), 1_000);
}

#[test]
fn test_full_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, contributor, token_id, _fee_recipient, _arbiter) = setup_test(&env);
    let token = TokenClient::new(&env, &token_id);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32, // zero fee
    );

    client.reserve_bounty(&bounty_id, &contributor);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);
    assert_eq!(bounty.contributor, Some(contributor.clone()));

    client.submit_bounty(&bounty_id, &contributor);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Submitted);

    client.release_bounty(&bounty_id, &maintainer);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);

    // With 0% fee: contributor receives full 500
    assert_eq!(token.balance(&contributor), 500);
    assert_eq!(token.balance(&client.address), 0);
}

#[test]
#[should_panic(expected = "BountyNotExpiredYet")]
fn test_refund_reserved_before_deadline_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.refund_bounty(&bounty_id, &maintainer);
}

#[test]
fn test_refund_after_deadline_reserved_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _contributor, token_id, _fee_recipient, _arbiter) = setup_test(&env);
    let token = TokenClient::new(&env, &token_id);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
    );

    env.ledger().set_timestamp(deadline + 1);

    client.refund_bounty(&bounty_id, &maintainer);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Refunded);
    // Refund returns full amount — no fee deducted
    assert_eq!(token.balance(&maintainer), 1000);
}

#[test]
fn test_cancel_bounty_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _contributor, token_id, _fee_recipient, _arbiter) = setup_test(&env);
    let token = soroban_sdk::token::Client::new(&env, &token_id);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
    );

    client.cancel_bounty(&bounty_id, &maintainer);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Refunded);
    assert_eq!(token.balance(&maintainer), 1000);
    assert_eq!(token.balance(&client.address), 0);
}

#[test]
#[should_panic(expected = "MaintainerMismatch")]
fn test_cancel_bounty_wrong_maintainer() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let other_maintainer = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
    );

    client.cancel_bounty(&bounty_id, &other_maintainer);
}

#[test]
#[should_panic(expected = "BountyNotOpen")]
fn test_cancel_bounty_non_open_reserved() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let bounty_id = create_bounty_with_state(
        &env,
        &client,
        maintainer.clone(),
        contributor.clone(),
        token_id.clone(),
        BountyStatus::Reserved,
    );

    client.cancel_bounty(&bounty_id, &maintainer);
}

invalid_transition_test!(reserve_reserved, BountyStatus::Reserved, "BountyNotOpen", {
    |client: &StellarBountyBoardContractClient<'static>,
     bounty_id: u64,
     _maintainer: Address,
     contributor: Address| { client.reserve_bounty(&bounty_id, &contributor) }
});
invalid_transition_test!(
    reserve_submitted,
    BountyStatus::Submitted,
    "BountyNotOpen",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.reserve_bounty(&bounty_id, &contributor) }
    }
);
invalid_transition_test!(reserve_released, BountyStatus::Released, "BountyNotOpen", {
    |client: &StellarBountyBoardContractClient<'static>,
     bounty_id: u64,
     _maintainer: Address,
     contributor: Address| { client.reserve_bounty(&bounty_id, &contributor) }
});
invalid_transition_test!(reserve_refunded, BountyStatus::Refunded, "BountyNotOpen", {
    |client: &StellarBountyBoardContractClient<'static>,
     bounty_id: u64,
     _maintainer: Address,
     contributor: Address| { client.reserve_bounty(&bounty_id, &contributor) }
});
invalid_transition_test!(reserve_expired, BountyStatus::Expired, "BountyNotOpen", {
    |client: &StellarBountyBoardContractClient<'static>,
     bounty_id: u64,
     _maintainer: Address,
     contributor: Address| { client.reserve_bounty(&bounty_id, &contributor) }
});

invalid_transition_test!(submit_open, BountyStatus::Open, "BountyMustBeReserved", {
    |client: &StellarBountyBoardContractClient<'static>,
     bounty_id: u64,
     _maintainer: Address,
     contributor: Address| { client.submit_bounty(&bounty_id, &contributor) }
});
invalid_transition_test!(
    submit_submitted,
    BountyStatus::Submitted,
    "BountyMustBeReserved",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.submit_bounty(&bounty_id, &contributor) }
    }
);
invalid_transition_test!(
    submit_released,
    BountyStatus::Released,
    "BountyMustBeReserved",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.submit_bounty(&bounty_id, &contributor) }
    }
);
invalid_transition_test!(
    submit_refunded,
    BountyStatus::Refunded,
    "BountyMustBeReserved",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.submit_bounty(&bounty_id, &contributor) }
    }
);
invalid_transition_test!(
    submit_expired,
    BountyStatus::Expired,
    "BountyMustBeReserved",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.submit_bounty(&bounty_id, &contributor) }
    }
);

invalid_transition_test!(release_open, BountyStatus::Open, "BountyMustBeSubmitted", {
    |client: &StellarBountyBoardContractClient<'static>,
     bounty_id: u64,
     maintainer: Address,
     _contributor: Address| { client.release_bounty(&bounty_id, &maintainer) }
});
invalid_transition_test!(
    release_reserved,
    BountyStatus::Reserved,
    "BountyMustBeSubmitted",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.release_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    release_released,
    BountyStatus::Released,
    "BountyMustBeSubmitted",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.release_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    release_refunded,
    BountyStatus::Refunded,
    "BountyMustBeSubmitted",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.release_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    release_expired,
    BountyStatus::Expired,
    "BountyMustBeSubmitted",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.release_bounty(&bounty_id, &maintainer) }
    }
);

invalid_transition_test!(refund_open, BountyStatus::Open, "BountyNotExpiredYet", {
    |client: &StellarBountyBoardContractClient<'static>,
     bounty_id: u64,
     maintainer: Address,
     _contributor: Address| { client.refund_bounty(&bounty_id, &maintainer) }
});
invalid_transition_test!(
    refund_reserved,
    BountyStatus::Reserved,
    "BountyNotExpiredYet",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.refund_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    refund_submitted,
    BountyStatus::Submitted,
    "BountyNotExpiredYet",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.refund_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    refund_released,
    BountyStatus::Released,
    "BountyAlreadyFinalized",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.refund_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    refund_refunded,
    BountyStatus::Refunded,
    "BountyAlreadyFinalized",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.refund_bounty(&bounty_id, &maintainer) }
    }
);

invalid_transition_test!(
    extend_released,
    BountyStatus::Released,
    "CannotExtendFinalizedBounty",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| {
            client.extend_deadline(&bounty_id, &maintainer, &1000000)
        }
    }
);
invalid_transition_test!(
    extend_refunded,
    BountyStatus::Refunded,
    "CannotExtendFinalizedBounty",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| {
            client.extend_deadline(&bounty_id, &maintainer, &1000000)
        }
    }
);
invalid_transition_test!(
    extend_expired,
    BountyStatus::Expired,
    "CannotExtendFinalizedBounty",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| {
            client.extend_deadline(&bounty_id, &maintainer, &1000000)
        }
    }
);

#[test]
#[should_panic(expected = "BountyNotOpen")]
fn test_concurrent_reservation_race_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.reserve_bounty(&bounty_id, &contributor);
}

#[test]
#[should_panic(expected = "BountyMustBeSubmitted")]
fn test_release_without_submit() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
fn test_expiration() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
    );

    env.ledger().set_timestamp(deadline + 1);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Expired);
}

#[test]
#[should_panic(expected = "BountyNotOpen")]
fn test_double_reserve_bounty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
    );

    // First reservation should succeed
    client.reserve_bounty(&bounty_id, &contributor);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);

    // Second reservation attempt should panic with Error::BountyNotOpen
    // because the bounty is no longer in Open status
    client.reserve_bounty(&bounty_id, &contributor);
}

#[test]
#[should_panic(expected = "BountyNotOpen")]
fn test_reserve_expired_bounty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
    );

    env.ledger().set_timestamp(deadline + 1);

    client.reserve_bounty(&bounty_id, &contributor);
}

#[test]
fn test_extend_deadline_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let initial_deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &initial_deadline,
        &0u32,
    );

    let new_deadline = initial_deadline + 5000;
    client.extend_deadline(&bounty_id, &maintainer, &new_deadline);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.deadline, new_deadline);
}

#[test]
#[should_panic(expected = "MaintainerMismatch")]
fn test_extend_deadline_wrong_caller() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let initial_deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &initial_deadline,
        &0u32,
    );

    let new_deadline = initial_deadline + 5000;

    // Attempting to extend using the contributor's address instead of the maintainer
    client.extend_deadline(&bounty_id, &contributor, &new_deadline);
}

#[test]
#[should_panic(expected = "DeadlineMustAdvance")]
fn test_extend_deadline_earlier() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let initial_deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &initial_deadline,
        &0u32,
    );

    // Attempting to set a deadline earlier than the initial one
    let earlier_deadline = initial_deadline - 100;
    client.extend_deadline(&bounty_id, &maintainer, &earlier_deadline);
}

#[test]
fn test_get_all_bounties_empty() {
    let env = Env::default();
    let (client, _, _, _, _, _) = setup_test(&env);

    let bounties = client.get_all_bounties(&1u64, &10u32);
    assert_eq!(bounties.len(), 0);
}

#[test]
fn test_get_all_bounties_out_of_bounds_returns_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
    );

    let bounties = client.get_all_bounties(&5u64, &10u32);
    assert_eq!(bounties.len(), 0);
}

#[test]
fn test_get_all_bounties_partial_page() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    for i in 0..3 {
        client.create_bounty(
            &maintainer,
            &token_id,
            &100,
            &String::from_str(&env, "repo"),
            &(i + 1),
            &String::from_str(&env, "title"),
            &(env.ledger().timestamp() + 1000),
            &0u32,
        );
    }

    let bounties = client.get_all_bounties(&2u64, &10u32);
    assert_eq!(bounties.len(), 2);
    assert_eq!(bounties.get(0).unwrap().issue_number, 2);
    assert_eq!(bounties.get(1).unwrap().issue_number, 3);
}

#[test]
fn test_get_all_bounties_full_page() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    for i in 0..5 {
        client.create_bounty(
            &maintainer,
            &token_id,
            &100,
            &String::from_str(&env, "repo"),
            &(i + 1),
            &String::from_str(&env, "title"),
            &(env.ledger().timestamp() + 1000),
            &0u32,
        );
    }

    let bounties = client.get_all_bounties(&1u64, &3u32);
    assert_eq!(bounties.len(), 3);
    assert_eq!(bounties.get(0).unwrap().issue_number, 1);
    assert_eq!(bounties.get(1).unwrap().issue_number, 2);
    assert_eq!(bounties.get(2).unwrap().issue_number, 3);
}

#[test]
fn test_get_all_bounties_limit_capped_at_50() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1_000_000);

    for i in 0..55 {
        client.create_bounty(
            &maintainer,
            &token_id,
            &100,
            &String::from_str(&env, "repo"),
            &(i + 1),
            &String::from_str(&env, "title"),
            &(env.ledger().timestamp() + 1000),
            &0u32,
        );
    }

    let bounties = client.get_all_bounties(&1u64, &100u32);
    assert_eq!(bounties.len(), 50);
    assert_eq!(bounties.get(0).unwrap().issue_number, 1);
    assert_eq!(bounties.get(49).unwrap().issue_number, 50);
}
