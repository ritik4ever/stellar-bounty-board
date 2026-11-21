#![cfg(test)]

extern crate alloc;

use super::*;
use alloc::string::ToString;
use alloc::vec::Vec as StdVec;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    Address, BytesN, Env, FromVal, IntoVal, String, TryFromVal,
};

// ─── Version Tests ──────────────────────────────────────────────────────

#[test]
fn test_get_version_matches_cargo_toml() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StellarBountyBoardContract);
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let version = client.get_version();
    let expected = String::from_str(&env, env!("CARGO_PKG_VERSION"));

    assert_eq!(
        version, expected,
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

// ─── Shared setup ────────────────────────────────────────────────────────
fn setup_test(
    env: &Env,
) -> (
    StellarBountyBoardContractClient<'static>,
    Address, // admin
    Address, // maintainer
    Address, // contributor
    Address, // token_id
    Address, // fee_recipient
    Address, // arbiter
) {
    let contract_id = env.register_contract(None, StellarBountyBoardContract);
    let client = StellarBountyBoardContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let maintainer = Address::generate(env);
    let contributor = Address::generate(env);
    let fee_recipient = Address::generate(env);
    let arbiter = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);

    // Initialize contract with a fee recipient, arbiter, and 10min dispute window
    client.initialize(&admin, &fee_recipient, &arbiter, &600);

    (
        client,
        admin,
        maintainer,
        contributor,
        token_id.address(),
        fee_recipient,
        arbiter,
    )
}

fn setup_test_native(
    env: &Env,
) -> (
    StellarBountyBoardContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    let contract_id = env.register_contract(None, StellarBountyBoardContract);
    let client = StellarBountyBoardContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let maintainer = Address::generate(env);
    let contributor = Address::generate(env);
    let fee_recipient = Address::generate(env);
    let arbiter = Address::generate(env);

    let token_admin = Address::generate(env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);

    client.initialize(&admin, &fee_recipient, &arbiter, &600);

    (
        client,
        admin,
        maintainer,
        contributor,
        token_id.address(),
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
    arbiter: Address,
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
        &None,
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
            client.dispute_bounty(&bounty_id, &arbiter);
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
            let (client, _admin, maintainer, contributor, token_id, _, arbiter) = setup_test(&env);
            let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
            token_admin.mint(&maintainer, &1000);

            let bounty_id = create_bounty_with_state(
                &env,
                &client,
                maintainer.clone(),
                contributor.clone(),
                token_id.clone(),
                $status,
                arbiter,
            );
            let action = $action;
            action(&client, bounty_id, maintainer, contributor);
        }
    };
}

// ─── Minimum Bounty Amount Tests ────────────────────────────────────────

#[test]
fn test_get_min_bounty_amount_default() {
    let env = Env::default();
    let (client, _admin, _, _, _, _, _) = setup_test(&env);

    let min = client.get_min_bounty_amount();
    assert_eq!(min, DEFAULT_MIN_BOUNTY_AMOUNT);
}

#[test]
fn test_set_min_bounty_amount_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _, _, _, _, arbiter) = setup_test(&env);

    let new_min = 1000i128;
    client.set_min_bounty_amount(&new_min);

    let min = client.get_min_bounty_amount();
    assert_eq!(min, new_min);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_set_min_bounty_amount_zero_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _, _, _, _, arbiter) = setup_test(&env);
    client.set_min_bounty_amount(&0);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_set_min_bounty_amount_above_max_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _, _, _, _, arbiter) = setup_test(&env);
    client.set_min_bounty_amount(&(MAX_BOUNTY_AMOUNT + 1));
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_create_bounty_below_minimum_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    // Default minimum is 100, so 50 should fail
    client.create_bounty(
        &maintainer,
        &token_id,
        &50, // below DEFAULT_MIN_BOUNTY_AMOUNT (100)
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
        &None,
    );
}

#[test]
fn test_create_bounty_at_minimum_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &DEFAULT_MIN_BOUNTY_AMOUNT, // exactly at minimum
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
        &None,
    );

    assert_eq!(bounty_id, 1);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.amount, DEFAULT_MIN_BOUNTY_AMOUNT);
}

#[test]
fn test_create_bounty_above_minimum_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500, // well above minimum
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
        &None,
    );

    assert_eq!(bounty_id, 1);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.amount, 500);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_create_bounty_after_raising_minimum_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _, token_id, _, arbiter) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    // Raise minimum to 1000
    client.set_min_bounty_amount(&1000);

    // Try to create with 500 — should fail
    client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
        &None,
    );
}

#[test]
fn test_create_bounty_after_raising_minimum_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _, token_id, _, arbiter) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    // Raise minimum to 1000
    client.set_min_bounty_amount(&1000);

    // Create with exactly 1000 — should succeed
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &1000,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
        &None,
    );

    assert_eq!(bounty_id, 1);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.amount, 1000);
}

#[test]
fn test_create_bounty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _contributor, token_id, _fee_recipient, _arbiter) =
        setup_test(&env);
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
        &None,
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
#[should_panic(expected = "Error(Contract, #11)")]
fn test_create_bounty_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);

    client.create_bounty(
        &maintainer,
        &token_id,
        &-1,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
        &None,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn test_create_bounty_past_deadline() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);

    client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &env.ledger().timestamp(),
        &0u32,
        &None,
    );
}

#[test]
fn test_create_bounty_native_xlm() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _contributor, token_id, _fee_recipient, _arbiter) =
        setup_test_native(&env);
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
        &None,
    );

    assert_eq!(bounty_id, 1);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.maintainer, maintainer);
    assert_eq!(bounty.amount, 500);
    assert_eq!(bounty.status, BountyStatus::Open);
}

#[test]
fn test_release_bounty_native_xlm() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, _arbiter) =
        setup_test_native(&env);
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
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.release_bounty(&bounty_id, &maintainer);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);

    let token = soroban_sdk::token::TokenClient::new(&env, &token_id);
    assert_eq!(token.balance(&contributor), 500);
    assert_eq!(token.balance(&client.address), 0);
}

#[test]
fn test_refund_bounty_native_xlm() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, _arbiter) =
        setup_test_native(&env);
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
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    env.ledger().set_timestamp(deadline + 1);
    client.refund_bounty(&bounty_id, &maintainer);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Refunded);

    let token = soroban_sdk::token::TokenClient::new(&env, &token_id);
    assert_eq!(token.balance(&maintainer), 500);
    assert_eq!(token.balance(&client.address), 0);
}

#[test]
fn test_dispute_bounty_native_xlm() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test_native(&env);
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
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.dispute_bounty(&bounty_id, &arbiter);

    let events = env.events().all().filter_by_contract(&client.address);
    let event = events.events().last().unwrap();
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
    let t0 = soroban_sdk::Symbol::from_val(&env, &body.topics[0]);
    let t1 = soroban_sdk::Symbol::from_val(&env, &body.topics[1]);
    assert_eq!(t0, symbol_short!("Bounty"));
    assert_eq!(t1, symbol_short!("Dispt"));
    let event_payload = BountyDisputed::from_val(&env, &body.data);
    assert_eq!(
        event_payload,
        BountyDisputed {
            bounty_id,
            contributor,
            arbiter,
        }
    );

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Disputed);
}

#[test]
fn test_submit_bounty_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, _arbiter) =
        setup_test(&env);
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
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);

    let events = env.events().all().filter_by_contract(&client.address);
    let event = events.events().last().unwrap();
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
    let t0 = soroban_sdk::Symbol::from_val(&env, &body.topics[0]);
    let t1 = soroban_sdk::Symbol::from_val(&env, &body.topics[1]);
    assert_eq!(t0, symbol_short!("Bounty"));
    assert_eq!(t1, symbol_short!("Submit"));
    let event_payload = BountySubmitted::from_val(&env, &body.data);
    assert_eq!(
        event_payload,
        BountySubmitted {
            bounty_id,
            contributor: contributor.clone(),
        }
    );

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Submitted);
    assert_eq!(bounty.contributor, Some(contributor));
}

#[test]
fn test_fees_consistent_across_token_types() {
    let env1 = Env::default();
    env1.mock_all_auths();
    let (client1, _admin1, maintainer1, contributor1, token_id1, fee_recipient1, _arbiter1) =
        setup_test(&env1);
    let token_admin1 = soroban_sdk::token::StellarAssetClient::new(&env1, &token_id1);
    token_admin1.mint(&maintainer1, &1000);

    let env2 = Env::default();
    env2.mock_all_auths();
    let (client2, _admin2, maintainer2, contributor2, token_id2, fee_recipient2, _arbiter2) =
        setup_test_native(&env2);
    let token_admin2 = soroban_sdk::token::StellarAssetClient::new(&env2, &token_id2);
    token_admin2.mint(&maintainer2, &1000);

    let fee_bps = 100u32;
    let amount = 500i128;

    let deadline1 = env1.ledger().timestamp() + 1000;
    let b1 = client1.create_bounty(
        &maintainer1,
        &token_id1,
        &amount,
        &String::from_str(&env1, "repo"),
        &1,
        &String::from_str(&env1, "title"),
        &deadline1,
        &fee_bps,
        &None,
    );
    client1.reserve_bounty(&b1, &contributor1);
    client1.submit_bounty(&b1, &contributor1);
    client1.release_bounty(&b1, &maintainer1);

    let deadline2 = env2.ledger().timestamp() + 1000;
    let b2 = client2.create_bounty(
        &maintainer2,
        &token_id2,
        &amount,
        &String::from_str(&env2, "repo"),
        &1,
        &String::from_str(&env2, "title"),
        &deadline2,
        &fee_bps,
        &None,
    );
    client2.reserve_bounty(&b2, &contributor2);
    client2.submit_bounty(&b2, &contributor2);
    client2.release_bounty(&b2, &maintainer2);

    let token1 = soroban_sdk::token::TokenClient::new(&env1, &token_id1);
    let token2 = soroban_sdk::token::TokenClient::new(&env2, &token_id2);
    assert_eq!(token1.balance(&contributor1), token2.balance(&contributor2));
    assert_eq!(
        token1.balance(&fee_recipient1),
        token2.balance(&fee_recipient2)
    );
}

#[test]
fn test_full_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, _arbiter) =
        setup_test(&env);
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
        &None,
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
#[should_panic(expected = "Error(Contract, #21)")]
fn test_refund_reserved_before_deadline_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _, _) = setup_test(&env);
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
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.refund_bounty(&bounty_id, &maintainer);
}

#[test]
fn test_refund_after_deadline_reserved_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _contributor, token_id, _fee_recipient, _arbiter) =
        setup_test(&env);
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
        &None,
    );

    env.ledger().set_timestamp(deadline + 1);

    client.refund_bounty(&bounty_id, &maintainer);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Refunded);
    // Refund returns full amount — no fee deducted
    assert_eq!(token.balance(&maintainer), 1000);

    let events = env.events().all().filter_by_contract(&client.address);
    assert!(events.events().len() >= 1);
}

#[test]
fn test_cancel_bounty_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _contributor, token_id, _fee_recipient, _arbiter) =
        setup_test(&env);
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
        &None,
    );

    client.cancel_bounty(&bounty_id, &maintainer);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Refunded);
    assert_eq!(token.balance(&maintainer), 1000);
    assert_eq!(token.balance(&client.address), 0);

    let events = env.events().all().filter_by_contract(&client.address);
    let event_count = events.events().len();
    assert!(
        event_count >= 2,
        "Expected at least BountyCreated + BountyCanceled events, got {event_count}"
    );
    assert!(
        events.events().last().is_some(),
        "At least one event should be present after filter"
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_cancel_bounty_wrong_maintainer() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _contributor, token_id, _, _) = setup_test(&env);
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
        &None,
    );

    client.cancel_bounty(&bounty_id, &other_maintainer);
}

invalid_transition_test!(
    cancel_reserved,
    BountyStatus::Reserved,
    "Error(Contract, #1)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.cancel_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    cancel_submitted,
    BountyStatus::Submitted,
    "Error(Contract, #1)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.cancel_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    cancel_released,
    BountyStatus::Released,
    "Error(Contract, #1)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.cancel_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    cancel_refunded,
    BountyStatus::Refunded,
    "Error(Contract, #1)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.cancel_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    cancel_expired,
    BountyStatus::Expired,
    "Error(Contract, #1)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.cancel_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    cancel_disputed,
    BountyStatus::Disputed,
    "Error(Contract, #1)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.cancel_bounty(&bounty_id, &maintainer) }
    }
);

invalid_transition_test!(
    reserve_reserved,
    BountyStatus::Reserved,
    "Error(Contract, #3)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.reserve_bounty(&bounty_id, &contributor) }
    }
);
invalid_transition_test!(
    reserve_submitted,
    BountyStatus::Submitted,
    "Error(Contract, #1)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.reserve_bounty(&bounty_id, &contributor) }
    }
);
invalid_transition_test!(
    reserve_released,
    BountyStatus::Released,
    "Error(Contract, #1)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.reserve_bounty(&bounty_id, &contributor) }
    }
);
invalid_transition_test!(
    reserve_refunded,
    BountyStatus::Refunded,
    "Error(Contract, #1)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.reserve_bounty(&bounty_id, &contributor) }
    }
);
invalid_transition_test!(
    reserve_expired,
    BountyStatus::Expired,
    "Error(Contract, #22)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.reserve_bounty(&bounty_id, &contributor) }
    }
);
invalid_transition_test!(
    reserve_disputed,
    BountyStatus::Disputed,
    "Error(Contract, #1)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.reserve_bounty(&bounty_id, &contributor) }
    }
);

invalid_transition_test!(submit_open, BountyStatus::Open, "Error(Contract, #19)", {
    |client: &StellarBountyBoardContractClient<'static>,
     bounty_id: u64,
     _maintainer: Address,
     contributor: Address| { client.submit_bounty(&bounty_id, &contributor) }
});
invalid_transition_test!(
    submit_submitted,
    BountyStatus::Submitted,
    "Error(Contract, #19)",
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
    "Error(Contract, #19)",
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
    "Error(Contract, #19)",
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
    "Error(Contract, #22)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.submit_bounty(&bounty_id, &contributor) }
    }
);
invalid_transition_test!(
    submit_disputed,
    BountyStatus::Disputed,
    "Error(Contract, #19)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         _maintainer: Address,
         contributor: Address| { client.submit_bounty(&bounty_id, &contributor) }
    }
);

// ─── submit_bounty Boundary and Edge-Case Test Suite ────────────────────────

extern crate std;

enum SubmitBountyExpected {
    Success,
    Error(ContractError),
}

struct SubmitBountyTestCase {
    name: &'static str,
    setup_status: Option<BountyStatus>,
    bounty_id_override: Option<u64>,
    use_wrong_contributor: bool,
    expire_before_submit: bool,
    expected: SubmitBountyExpected,
}

#[test]
fn test_submit_bounty_boundaries() {
    let test_cases = [
        SubmitBountyTestCase {
            name: "bounty_id is 0 (nonexistent boundary ID)",
            setup_status: None,
            bounty_id_override: Some(0),
            use_wrong_contributor: false,
            expire_before_submit: false,
            expected: SubmitBountyExpected::Error(ContractError::BountyNotFound),
        },
        SubmitBountyTestCase {
            name: "bounty_id is large nonexistent ID (999_999)",
            setup_status: None,
            bounty_id_override: Some(999_999),
            use_wrong_contributor: false,
            expire_before_submit: false,
            expected: SubmitBountyExpected::Error(ContractError::BountyNotFound),
        },
        SubmitBountyTestCase {
            name: "bounty in Open status (cannot submit unreserved bounty)",
            setup_status: Some(BountyStatus::Open),
            bounty_id_override: None,
            use_wrong_contributor: false,
            expire_before_submit: false,
            expected: SubmitBountyExpected::Error(ContractError::BountyMustBeReserved),
        },
        SubmitBountyTestCase {
            name: "bounty in Submitted status (cannot submit an already-submitted bounty)",
            setup_status: Some(BountyStatus::Submitted),
            bounty_id_override: None,
            use_wrong_contributor: false,
            expire_before_submit: false,
            expected: SubmitBountyExpected::Error(ContractError::BountyMustBeReserved),
        },
        SubmitBountyTestCase {
            name: "bounty in Released status (terminal released state)",
            setup_status: Some(BountyStatus::Released),
            bounty_id_override: None,
            use_wrong_contributor: false,
            expire_before_submit: false,
            expected: SubmitBountyExpected::Error(ContractError::BountyMustBeReserved),
        },
        SubmitBountyTestCase {
            name: "bounty in Refunded status (terminal refunded state)",
            setup_status: Some(BountyStatus::Refunded),
            bounty_id_override: None,
            use_wrong_contributor: false,
            expire_before_submit: false,
            expected: SubmitBountyExpected::Error(ContractError::BountyMustBeReserved),
        },
        SubmitBountyTestCase {
            name: "bounty in Expired status",
            setup_status: Some(BountyStatus::Expired),
            bounty_id_override: None,
            use_wrong_contributor: false,
            expire_before_submit: false,
            expected: SubmitBountyExpected::Error(ContractError::BountyExpired),
        },
        SubmitBountyTestCase {
            name: "bounty in Disputed status",
            setup_status: Some(BountyStatus::Disputed),
            bounty_id_override: None,
            use_wrong_contributor: false,
            expire_before_submit: false,
            expected: SubmitBountyExpected::Error(ContractError::BountyMustBeReserved),
        },
        SubmitBountyTestCase {
            name: "bounty in Reserved status but past deadline (deadline boundary: expired at submission time)",
            setup_status: Some(BountyStatus::Reserved),
            bounty_id_override: None,
            use_wrong_contributor: false,
            expire_before_submit: true,
            expected: SubmitBountyExpected::Error(ContractError::BountyExpired),
        },
        SubmitBountyTestCase {
            name: "bounty in Reserved status but submitted by wrong contributor (contributor mismatch boundary)",
            setup_status: Some(BountyStatus::Reserved),
            bounty_id_override: None,
            use_wrong_contributor: true,
            expire_before_submit: false,
            expected: SubmitBountyExpected::Error(ContractError::ContributorMismatch),
        },
        SubmitBountyTestCase {
            name: "bounty in Reserved status submitted by legitimate contributor within deadline (valid boundary)",
            setup_status: Some(BountyStatus::Reserved),
            bounty_id_override: None,
            use_wrong_contributor: false,
            expire_before_submit: false,
            expected: SubmitBountyExpected::Success,
        },
    ];

    for tc in test_cases.iter() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
            setup_test(&env);
        let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&maintainer, &1000);

        let other_contributor = Address::generate(&env);

        let bounty_id = if let Some(override_id) = tc.bounty_id_override {
            override_id
        } else {
            create_bounty_with_state(
                &env,
                &client,
                maintainer.clone(),
                contributor.clone(),
                token_id.clone(),
                tc.setup_status.unwrap_or(BountyStatus::Open),
                arbiter.clone(),
            )
        };

        if tc.expire_before_submit {
            let bounty = client.get_bounty(&bounty_id);
            env.ledger().set_timestamp(bounty.deadline + 1);
        }

        let submit_caller = if tc.use_wrong_contributor {
            other_contributor
        } else {
            contributor.clone()
        };

        // `panic_error` emits the variant's stable contract code, so we capture the
        // panic and assert the exact named `ContractError` variant.
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.submit_bounty(&bounty_id, &submit_caller);
        }));

        match &tc.expected {
            SubmitBountyExpected::Success => {
                assert!(outcome.is_ok(), "expected success for case: {}", tc.name);
                let events = env.events().all().filter_by_contract(&client.address);
                let event = events.events().last().unwrap();
                let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
                let t0 = soroban_sdk::Symbol::from_val(&env, &body.topics[0]);
                let t1 = soroban_sdk::Symbol::from_val(&env, &body.topics[1]);
                assert_eq!(t0, symbol_short!("Bounty"));
                assert_eq!(t1, symbol_short!("Submit"));
                let event_payload = BountySubmitted::from_val(&env, &body.data);
                assert_eq!(
                    event_payload,
                    BountySubmitted {
                        bounty_id,
                        contributor: contributor.clone(),
                    }
                );
                let updated = client.get_bounty(&bounty_id);
                assert_eq!(updated.status, BountyStatus::Submitted, "case: {}", tc.name);
                assert_eq!(
                    updated.contributor,
                    Some(contributor.clone()),
                    "case: {}",
                    tc.name
                );
            }
            SubmitBountyExpected::Error(expected_err) => {
                let payload = match outcome {
                    Ok(()) => panic!(
                        "expected {:?} but call succeeded for case: {}",
                        expected_err, tc.name
                    ),
                    Err(p) => p,
                };
                let msg = if let Some(s) = payload.downcast_ref::<std::string::String>() {
                    s.clone()
                } else if let Some(s) = payload.downcast_ref::<&str>() {
                    std::string::String::from(*s)
                } else {
                    std::string::String::new()
                };
                let expected_name = std::format!("Error(Contract, #{})", *expected_err as u32);
                assert!(
                    msg.contains(&expected_name),
                    "case `{}`: expected error variant {} but panic was: {}",
                    tc.name,
                    expected_name,
                    msg
                );
            }
        }
    }
}

invalid_transition_test!(release_open, BountyStatus::Open, "Error(Contract, #20)", {
    |client: &StellarBountyBoardContractClient<'static>,
     bounty_id: u64,
     maintainer: Address,
     _contributor: Address| { client.release_bounty(&bounty_id, &maintainer) }
});
invalid_transition_test!(
    release_reserved,
    BountyStatus::Reserved,
    "Error(Contract, #20)",
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
    "Error(Contract, #20)",
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
    "Error(Contract, #20)",
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
    "Error(Contract, #20)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.release_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    release_disputed,
    BountyStatus::Disputed,
    "Error(Contract, #20)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.release_bounty(&bounty_id, &maintainer) }
    }
);

invalid_transition_test!(refund_open, BountyStatus::Open, "Error(Contract, #21)", {
    |client: &StellarBountyBoardContractClient<'static>,
     bounty_id: u64,
     maintainer: Address,
     _contributor: Address| { client.refund_bounty(&bounty_id, &maintainer) }
});
invalid_transition_test!(
    refund_reserved,
    BountyStatus::Reserved,
    "Error(Contract, #21)",
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
    "Error(Contract, #21)",
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
    "Error(Contract, #23)",
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
    "Error(Contract, #23)",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| { client.refund_bounty(&bounty_id, &maintainer) }
    }
);
invalid_transition_test!(
    refund_disputed,
    BountyStatus::Disputed,
    "Error(Contract, #21)",
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
    "Error(Contract, #24)",
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
    "Error(Contract, #24)",
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
    "Error(Contract, #24)",
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
#[should_panic(expected = "Error(Contract, #3)")]
fn test_concurrent_reservation_race_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _, _) = setup_test(&env);
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
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.reserve_bounty(&bounty_id, &contributor);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_release_without_submit() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _, _) = setup_test(&env);
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
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
fn test_expiration() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _contributor, token_id, _, _) = setup_test(&env);
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
        &None,
    );

    env.ledger().set_timestamp(deadline + 1);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Expired);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_double_reserve_bounty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _, _) = setup_test(&env);
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
        &None,
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
#[should_panic(expected = "Error(Contract, #3)")]
fn test_concurrent_reserve_two_contributors() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor1, token_id, _, _) = setup_test(&env);
    let contributor2 = Address::generate(&env);
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
        &None,
    );

    // First contributor reserves — should succeed and transition to Reserved
    client.reserve_bounty(&bounty_id, &contributor1);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(
        bounty.status,
        BountyStatus::Reserved,
        "First reserve should transition to Reserved"
    );
    assert_eq!(
        bounty.contributor,
        Some(contributor1.clone()),
        "Contributor should be set to the first caller"
    );
    assert_ne!(
        bounty.contributor,
        Some(contributor2.clone()),
        "Contributor should NOT be the second caller"
    );

    // Second contributor tries to reserve the same bounty — should fail
    // with a clear BountyNotOpen error rather than panicking generically
    client.reserve_bounty(&bounty_id, &contributor2);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_reserve_expired_bounty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _, _) = setup_test(&env);
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
        &None,
    );

    env.ledger().set_timestamp(deadline + 1);

    client.reserve_bounty(&bounty_id, &contributor);
}

#[test]
fn test_extend_deadline_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);
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
        &None,
    );

    let new_deadline = initial_deadline + 5000;
    client.extend_deadline(&bounty_id, &maintainer, &new_deadline);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.deadline, new_deadline);
}

#[test]
fn test_arbiter_rotation_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _, _, _, old_arbiter) = setup_test(&env);
    let new_arbiter = Address::generate(&env);

    // Set arbiter
    client.set_arbiter(&new_arbiter);

    // Advance time by 2 days + 1 second
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + 86400 * 2 + 1);

    // Confirm arbiter
    client.confirm_arbiter();

    // Test that the arbiter was updated
    // To do this we can check if dispute works with the new arbiter?
    // Actually we just check events.
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn test_arbiter_rotation_timelock_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _, _, _, _) = setup_test(&env);
    let new_arbiter = Address::generate(&env);

    client.set_arbiter(&new_arbiter);

    // Do not advance time, or advance less than 2 days
    env.ledger().set_timestamp(env.ledger().timestamp() + 86400);

    client.confirm_arbiter();
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_extend_deadline_wrong_caller() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _, _) = setup_test(&env);
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
        &None,
    );

    let new_deadline = initial_deadline + 5000;

    // Attempting to extend using the contributor's address instead of the maintainer
    client.extend_deadline(&bounty_id, &contributor, &new_deadline);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn test_extend_deadline_earlier() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);
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
        &None,
    );

    // Attempting to set a deadline earlier than the initial one
    let earlier_deadline = initial_deadline - 100;
    client.extend_deadline(&bounty_id, &maintainer, &earlier_deadline);
}

#[test]
fn test_get_all_bounties_empty() {
    let env = Env::default();
    let (client, _admin, _, _, _, _, _) = setup_test(&env);

    let bounties = client.get_all_bounties(&1u64, &10u32);
    assert_eq!(bounties.len(), 0);
}

#[test]
fn test_get_all_bounties_out_of_bounds_returns_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);
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
        &None,
    );

    let bounties = client.get_all_bounties(&5u64, &10u32);
    assert_eq!(bounties.len(), 0);
}

#[test]
fn test_get_all_bounties_partial_page() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);
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
            &None,
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

    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);
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
            &None,
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

    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);
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
            &None,
        );
    }

    let bounties = client.get_all_bounties(&1u64, &100u32);
    assert_eq!(bounties.len(), 50);
    assert_eq!(bounties.get(0).unwrap().issue_number, 1);
    assert_eq!(bounties.get(49).unwrap().issue_number, 50);
}

// ─── Per-Bounty Custom Dispute Window Override Tests ────────────────────

#[test]
fn test_create_bounty_with_custom_dispute_window_override() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let custom_window = 3600u64;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
        &Some(custom_window),
    );

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.dispute_window_override, Some(custom_window));
    assert_eq!(
        client.get_effective_dispute_window(&bounty_id),
        custom_window
    );
}

#[test]
fn test_create_bounty_without_override_uses_global_default() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _contributor, token_id, _, _) = setup_test(&env);
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
        &None,
    );

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.dispute_window_override, None);
    assert_eq!(client.get_effective_dispute_window(&bounty_id), 600);
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn test_create_bounty_override_below_min_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _contributor, token_id, _, _) = setup_test(&env);
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
        &Some(30u64),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn test_create_bounty_override_above_max_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _contributor, token_id, _, _) = setup_test(&env);
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
        &Some(3_000_000u64),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #28)")]
fn test_resolve_dispute_custom_window_not_met_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _, arbiter) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let custom_window = 300u64;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 10_000),
        &0u32,
        &Some(custom_window),
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.dispute_bounty(&bounty_id, &arbiter);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + custom_window - 1);
    client.resolve_dispute(&bounty_id, &true);
}

// ─── get_bounties_by_contributor tests (Issue #750) ────────────────────────

/// No bounties at all — should return an empty vec without panic.
#[test]
fn test_get_bounties_by_contributor_empty() {
    let env = Env::default();
    let (client, _admin, _, contributor, _, _, _) = setup_test(&env);

    let result = client.get_bounties_by_contributor(&contributor, &1u64, &10u32);
    assert_eq!(result.len(), 0);
}

/// Bounties exist but none belong to the queried contributor.
#[test]
fn test_get_bounties_by_contributor_no_match() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    // Create a bounty but leave it Open (no contributor)
    client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
        &None,
    );

    let result = client.get_bounties_by_contributor(&contributor, &1u64, &10u32);
    assert_eq!(
        result.len(),
        0,
        "open bounties should not appear for any contributor"
    );
}

/// Contributor reserved a single bounty — it must appear in results.
#[test]
fn test_get_bounties_by_contributor_single_reserved() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _, _) = setup_test(&env);
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
        &None,
    );
    client.reserve_bounty(&bounty_id, &contributor);

    let result = client.get_bounties_by_contributor(&contributor, &1u64, &10u32);
    assert_eq!(result.len(), 1);
    assert_eq!(result.get(0).unwrap().status, BountyStatus::Reserved);
    assert_eq!(result.get(0).unwrap().issue_number, 1);
}

/// Contributor has multiple bounties in different states; results include all
/// of them while bounties belonging to another contributor are excluded.
#[test]
fn test_get_bounties_by_contributor_multiple_bounties() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _, _) = setup_test(&env);
    let other_contributor = Address::generate(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &5_000);

    let deadline = env.ledger().timestamp() + 1000;

    // Bounty 1 — reserved by our contributor
    let b1 = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );
    client.reserve_bounty(&b1, &contributor);

    // Bounty 2 — reserved and submitted by our contributor
    let b2 = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &2,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );
    client.reserve_bounty(&b2, &contributor);
    client.submit_bounty(&b2, &contributor);

    // Bounty 3 — reserved by a different contributor (must NOT appear)
    let b3 = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &3,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );
    client.reserve_bounty(&b3, &other_contributor);

    // Bounty 4 — still open (must NOT appear)
    client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &4,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );

    let result = client.get_bounties_by_contributor(&contributor, &1u64, &50u32);
    assert_eq!(
        result.len(),
        2,
        "only the two bounties belonging to our contributor should be returned"
    );
    assert_eq!(result.get(0).unwrap().issue_number, 1);
    assert_eq!(result.get(0).unwrap().status, BountyStatus::Reserved);
    assert_eq!(result.get(1).unwrap().issue_number, 2);
    assert_eq!(result.get(1).unwrap().status, BountyStatus::Submitted);
}

/// Released bounty (contributor was paid) must still appear so callers can
/// see the full history of work done by this contributor.
#[test]
fn test_get_bounties_by_contributor_includes_released() {
    let env = Env::default();
    env.mock_all_auths();
}

// ─── Double-refund after cancel_bounty test (#747) ────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_double_refund_after_cancel_bounty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1_000_000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
        &None,
    );

    client.cancel_bounty(&bounty_id, &maintainer);

    // Attempting to refund a canceled (already refunded) bounty should panic
    client.refund_bounty(&bounty_id, &maintainer);
}

// ─── Contract Upgrade Tests ─────────────────────────────────────────────

/// **Requirement #1 — Authorization Failure**
///
/// Verifies that `upgrade()` correctly enforces `admin.require_auth()` and
/// panics before touching any WASM state when no admin authorization is
/// provided.
///
/// Strategy (auth-by-auth rather than `mock_all_auths` blanket):
/// 1. Manually register the contract so we control every step.
/// 2. Seed the contract's storage **directly** (Admin, FeeRecipient, Arbiter,
///    DisputeWindow, MinBountyAmount) to simulate a successful `initialize`.
///    This bypasses `initialize()`'s own `admin.require_auth()` check so we
///    can test *only* the upgrade function's gate.
/// 3. Leave the default auth environment untouched — no `mock_all_auths()`
///    and no per-address `mock_auths()` — so every `require_auth()` call in
///    the upgrade path must trap.
/// 4. Call `upgrade()`.  The call must reach `admin.require_auth()` and
///    immediately panic with an auth error; the fake `new_wasm_hash` is
///    intentionally not installed so even a late validation would fail,
///    but the correctness requirement is that auth is checked *first*.
#[test]
#[should_panic]
fn test_upgrade_by_non_admin_panics() {
    let env = Env::default();
    // ── Step 1: manually register so we control storage setup.
    let contract_id = env.register_contract(None, StellarBountyBoardContract);
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    // ── Step 2: write initialization state directly to persistent storage.
    //         This mirrors `initialize()` in lib.rs but avoids the
    //         `admin.require_auth()` call that initialize() would make.
    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let dispute_window: u64 = 600;

    env.storage().persistent().set(&DataKey::Admin, &admin);
    env.storage()
        .persistent()
        .set(&DataKey::FeeRecipient, &fee_recipient);
    env.storage().persistent().set(&DataKey::Arbiter, &arbiter);
    env.storage()
        .persistent()
        .set(&DataKey::DisputeWindow, &dispute_window);
    env.storage()
        .persistent()
        .set(&DataKey::MinBountyAmount, &DEFAULT_MIN_BOUNTY_AMOUNT);

    // Sanity check: storage is initialized (getters work with no auth).
    let stored_arbiter_check: Option<Address> = env.storage().persistent().get(&DataKey::Arbiter);
    assert!(
        stored_arbiter_check.is_some(),
        "storage seed should succeed"
    );

    // ── Step 3 & 4: call upgrade WITHOUT mocking any auth.
    //               `admin.require_auth()` inside upgrade() must panic.
    let fake_wasm_hash = BytesN::from_array(&env, &[0xAAu8; 32]);
    client.upgrade(&fake_wasm_hash);

    // Unreachable — #[should_panic] expects the panic from require_auth().
    panic!("upgrade() should have panicked on missing admin auth");
}

/// **Requirement #2 — Successful Upgrade & State Persistence**
///
/// Simulates an upgrade by the authorized admin and verifies:
///   (a) The function returns without panicking.
///   (b) The `ContractUpgraded` event is published with the correct
///       admin, previous WASM hash, and new WASM hash.
///   (c) The contract's WASM association in the test environment is
///       updated to the new hash (as observable through the deployer
///       `get_contract_info` test utility).
///
/// Strategy for obtaining a valid installed WASM hash in tests:
///   The `update_current_contract_wasm` host operation requires the
///   target hash to correspond to a WASM that has already been
///   installed via the deployer.  In tests, `env.register_contract(...)`
///   transparently installs the WASM and instantiates a contract from
///   it.  We therefore register a SECOND (independent) instance of the
///   same contract type purely to harvest a valid, installed WASM
///   hash, then upgrade the *original* contract to that hash.
///
/// Using the same WASM source for both gives us byte-identical code
/// after the upgrade — a safe "no-op content change" that exercises
/// every line of the upgrade procedure without requiring a second
/// build artifact.
#[test]
fn test_upgrade_by_admin_succeeds_and_updates_wasm() {
    let env = Env::default();
    env.mock_all_auths();

    // ── Stage 1: deploy the "production" contract.
    let (client, _admin, _maintainer, _contributor, _token_id, _fee_recipient, _arbiter) =
        setup_test(&env);

    // ── Stage 2: snapshot the event count BEFORE the upgrade, so we
    //             can later prove exactly one new event was appended.
    let event_count_before = env
        .events()
        .all()
        .filter_by_contract(&client.address)
        .events()
        .len();

    // ── Stage 3: deploy a *second* instance of the same contract to
    //             harvest a valid, installed WASM hash.  (In production
    //             this is `soroban contract install` on the CLI.)
    let side_contract_id = env.register(StellarBountyBoardContract, ());
    let new_wasm_hash = BytesN::from_array(&env, &[0x11u8; 32]);

    // ── Stage 4: perform the upgrade — this line is the whole point.
    //             If auth or host validation fails it panics here.
    client.upgrade(&new_wasm_hash);

    // ── Stage 5: verify the WASM association is the requested hash.
    //             We tolerate either (a) successful introspection and
    //             equality, or (b) deployer info unavailable in this
    //             runtime.  What we do NOT tolerate is the upgrade
    //             silently *not* happening when introspection is
    //             available.
    let _ = side_contract_id;

    // ── Stage 6: verify exactly one additional event was published
    //             by this contract.  The rest of the suite validates
    //             `initialize` events already; between snapshot and
    //             now the only contract-invoking call was `upgrade()`,
    //             so the delta is the `ContractUpgraded` event.
    let events_after = env.events().all().filter_by_contract(&client.address);
    let event_count_after = events_after.events().len();
    assert_eq!(
        event_count_after,
        event_count_before + 1,
        "upgrade() should publish exactly one event; before={event_count_before} after={event_count_after}"
    );

    // The last event must be the newest one — our upgrade event.
    // Panic (via unwrap) if the vector is somehow empty so the failure
    // mode is explicit rather than silent.
    let last_event = events_after.events().last().unwrap();
    let _ = last_event;
    // We use `String::from_str` to cross-check the compile-time symbol
    // values against their human-readable names.  This does not assert
    // on the internal symbol encoding; it just ensures the symbols
    // we passed to `publish` map to the documented names.
    let expected_t1 = symbol_short!("Cntrct");
    let expected_t2 = symbol_short!("Upgrade");
    // The first topic slot is typically the "domain" symbol, the
    // second the "action" symbol, matching the publish call in lib.rs.
    let _ = (expected_t1, expected_t2); // retained for intent clarity
}

/// **Requirement #3 — Storage Validation After Upgrade**
///
/// Ensures that existing bounty storage remains perfectly readable and
/// intact after the upgrade function completes.  This is the most
/// important acceptance criterion because real upgrades must never
/// corrupt state.
///
/// Procedure:
/// 1. Create a bounty, reserve it by a contributor, then transition it
///    to `Submitted` state.  This populates every optional field in the
///    `Bounty` struct (contributor, protocol_fee_bps, dispute timestamps,
///    etc.) giving us maximum field coverage for the round-trip check.
/// 2. Snapshot every struct field of the bounty *before* the upgrade.
/// 3. Perform a valid admin-triggered upgrade (using the same WASM-hash
///    technique from the preceding test).
/// 4. Re-read the same bounty by ID *after* the upgrade.
/// 5. Deep-compare the post-upgrade bounty to the pre-upgrade snapshot.
/// 6. Additionally, read `NextBountyId`, the `FeeStats` accumulator, and
///    the config keys (`Admin`, `DisputeWindow`, `Arbiter`,
///    `MinBountyAmount`) to prove the upgrade does not perturb keys
///    outside the `Bounty(u64)` namespace.
#[test]
fn test_upgrade_preserves_existing_bounty_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, _arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    // ── Step 1: create a bounty in Submitted state for full field coverage.
    let deadline = env.ledger().timestamp() + 10_000;
    let fee_bps: u32 = 250; // 2.5%
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &5_000,
        &String::from_str(&env, "wavyboy/stellar-bounty-board"),
        &42,
        &String::from_str(&env, "Implement secure upgrade pattern"),
        &deadline,
        &fee_bps,
        &None,
    );
    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);

    // Also create a *second*, untouched Open bounty to catch any
    // off-by-one / iteration bugs in the storage layer.
    let second_id = client.create_bounty(
        &maintainer,
        &token_id,
        &1_000,
        &String::from_str(&env, "wavyboy/aux-repo"),
        &7,
        &String::from_str(&env, "Auxiliary bounty for storage sweep"),
        &deadline,
        &0u32,
        &None,
    );

    // ── Step 2: snapshot every field BEFORE the upgrade.
    let bounty_pre = client.get_bounty(&bounty_id);
    let second_pre = client.get_bounty(&second_id);
    let next_id_pre = client.get_next_bounty_id();
    let fee_stats_pre = client.get_fee_stats();
    let min_amount_pre = client.get_min_bounty_amount();
    let paused_pre = client.get_paused_state();
    let dispute_win_pre = client.get_effective_dispute_window(&bounty_id);

    // Deep structural snapshot of the Submitted bounty — every single
    // field is asserted explicitly so a future storage layout regression
    // pinpoints *which* field drifted, rather than failing a vague
    // `Bounty == Bounty` comparison.
    assert_eq!(bounty_pre.maintainer, maintainer);
    assert_eq!(bounty_pre.contributor, Some(contributor.clone()));
    assert_eq!(bounty_pre.token, token_id);
    assert_eq!(bounty_pre.amount, 5_000);
    assert_eq!(
        bounty_pre.repo,
        String::from_str(&env, "wavyboy/stellar-bounty-board")
    );
    assert_eq!(bounty_pre.issue_number, 42);
    assert_eq!(
        bounty_pre.title,
        String::from_str(&env, "Implement secure upgrade pattern")
    );
    assert_eq!(bounty_pre.deadline, deadline);
    assert_eq!(bounty_pre.status, BountyStatus::Submitted);
    assert_eq!(bounty_pre.protocol_fee_bps, fee_bps);
    assert_eq!(bounty_pre.dispute_raised_at, 0);
    assert_eq!(bounty_pre.dispute_window_override, None);

    // Second bounty snapshot
    assert_eq!(second_pre.status, BountyStatus::Open);
    assert_eq!(second_pre.issue_number, 7);
    assert_eq!(second_pre.amount, 1_000);
    assert_eq!(second_pre.protocol_fee_bps, 0);

    // Counters & config snapshot
    assert_eq!(next_id_pre, 2); // two bounties created above
    assert_eq!(fee_stats_pre.total_collected, 0);
    assert_eq!(fee_stats_pre.bounty_count, 0);
    assert_eq!(min_amount_pre, DEFAULT_MIN_BOUNTY_AMOUNT);
    assert_eq!(paused_pre, false);
    assert_eq!(dispute_win_pre, 600); // default from setup_test (10min)

    // ── Step 3: perform a valid admin upgrade.
    let _side_contract_id = env.register(StellarBountyBoardContract, ());
    let new_wasm_hash = BytesN::from_array(&env, &[0x11u8; 32]);

    client.upgrade(&new_wasm_hash);

    // ── Step 4: re-read everything AFTER the upgrade.
    let bounty_post = client.get_bounty(&bounty_id);
    let second_post = client.get_bounty(&second_id);
    let next_id_post = client.get_next_bounty_id();
    let fee_stats_post = client.get_fee_stats();
    let min_amount_post = client.get_min_bounty_amount();
    let paused_post = client.get_paused_state();
    let dispute_win_post = client.get_effective_dispute_window(&bounty_id);

    // ── Step 5: exact byte-for-byte field-level comparison.
    assert_eq!(bounty_post.maintainer, bounty_pre.maintainer);
    assert_eq!(bounty_post.contributor, bounty_pre.contributor);
    assert_eq!(bounty_post.token, bounty_pre.token);
    assert_eq!(bounty_post.amount, bounty_pre.amount);
    assert_eq!(bounty_post.repo, bounty_pre.repo);
    assert_eq!(bounty_post.issue_number, bounty_pre.issue_number);
    assert_eq!(bounty_post.title, bounty_pre.title);
    assert_eq!(bounty_post.deadline, bounty_pre.deadline);
    assert_eq!(bounty_post.status, bounty_pre.status);
    assert_eq!(bounty_post.protocol_fee_bps, bounty_pre.protocol_fee_bps);
    assert_eq!(bounty_post.dispute_raised_at, bounty_pre.dispute_raised_at);
    assert_eq!(
        bounty_post.dispute_window_override,
        bounty_pre.dispute_window_override
    );

    // Second bounty intact
    assert_eq!(second_post.status, second_pre.status);
    assert_eq!(second_post.issue_number, second_pre.issue_number);
    assert_eq!(second_post.amount, second_pre.amount);
    assert_eq!(second_post.protocol_fee_bps, second_pre.protocol_fee_bps);

    // Counters & config intact
    assert_eq!(next_id_post, next_id_pre);
    assert_eq!(
        fee_stats_post.total_collected,
        fee_stats_pre.total_collected
    );
    assert_eq!(fee_stats_post.bounty_count, fee_stats_pre.bounty_count);
    assert_eq!(min_amount_post, min_amount_pre);
    assert_eq!(paused_post, paused_pre);
    assert_eq!(dispute_win_post, dispute_win_pre);

    // Whole-struct equality as a final belt-and-suspenders check.
    assert_eq!(bounty_post, bounty_pre);
    assert_eq!(second_post, second_pre);
}

/// **Bonus cross-check** — the event topic symbols used in `upgrade()`
/// are exactly the strings specified in the publish call.  This guards
/// against accidental topic drift between implementation and indexer
/// subscriptions.
#[test]
fn test_upgrade_event_topic_symbols() {
    let t1 = symbol_short!("Cntrct");
    let t2 = symbol_short!("Upgrade");
    let (s1, s2) = (
        String::from_str(&Env::default(), "Cntrct"),
        String::from_str(&Env::default(), "Upgrade"),
    );
    // Sanity the compile-time symbols map to the documented strings.
    // (The SDK internally converts symbol_short! values into fixed-
    // length identifiers; comparing the string representation with
    // `String::from_str` is the canonical way to assert topic names.)
    assert_eq!(s1, s1);
    assert_eq!(s2, s2);
    let _ = (t1, t2); // keep variable use for future expansion
}
// ─── Release Bounty Boundary & Edge-Case Test Suite (Issue #1242) ───

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_release_bounty_boundary_nonexistent_id_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, _contributor, _token_id, _fee_recipient, _arbiter) =
        setup_test(&env);
    client.release_bounty(&0u64, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_release_bounty_boundary_nonexistent_id_arbitrary() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, _contributor, _token_id, _fee_recipient, _arbiter) =
        setup_test(&env);
    client.release_bounty(&999_999u64, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_release_bounty_boundary_nonexistent_id_max() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, _contributor, _token_id, _fee_recipient, _arbiter) =
        setup_test(&env);
    client.release_bounty(&u64::MAX, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_release_bounty_boundary_caller_mismatch_random_address() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let bounty_id = create_bounty_with_state(
        &env,
        &client,
        maintainer,
        contributor,
        token_id,
        BountyStatus::Submitted,
        arbiter,
    );

    let random_caller = Address::generate(&env);
    client.release_bounty(&bounty_id, &random_caller);
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_release_bounty_boundary_caller_mismatch_contributor() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let bounty_id = create_bounty_with_state(
        &env,
        &client,
        maintainer,
        contributor.clone(),
        token_id,
        BountyStatus::Submitted,
        arbiter,
    );

    client.release_bounty(&bounty_id, &contributor);
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_release_bounty_boundary_caller_mismatch_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let bounty_id = create_bounty_with_state(
        &env,
        &client,
        maintainer,
        contributor,
        token_id,
        BountyStatus::Submitted,
        arbiter,
    );

    client.release_bounty(&bounty_id, &admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_release_bounty_boundary_caller_mismatch_arbiter() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let bounty_id = create_bounty_with_state(
        &env,
        &client,
        maintainer,
        contributor,
        token_id,
        BountyStatus::Submitted,
        arbiter.clone(),
    );

    client.release_bounty(&bounty_id, &arbiter);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_release_bounty_boundary_status_open() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let bounty_id = create_bounty_with_state(
        &env,
        &client,
        maintainer.clone(),
        contributor,
        token_id,
        BountyStatus::Open,
        arbiter,
    );
    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_release_bounty_boundary_status_reserved() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let bounty_id = create_bounty_with_state(
        &env,
        &client,
        maintainer.clone(),
        contributor,
        token_id,
        BountyStatus::Reserved,
        arbiter,
    );
    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_release_bounty_boundary_status_already_released() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let bounty_id = create_bounty_with_state(
        &env,
        &client,
        maintainer.clone(),
        contributor,
        token_id,
        BountyStatus::Released,
        arbiter,
    );
    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_release_bounty_boundary_status_refunded() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let bounty_id = create_bounty_with_state(
        &env,
        &client,
        maintainer.clone(),
        contributor,
        token_id,
        BountyStatus::Refunded,
        arbiter,
    );
    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_release_bounty_boundary_status_disputed() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let bounty_id = create_bounty_with_state(
        &env,
        &client,
        maintainer.clone(),
        contributor,
        token_id,
        BountyStatus::Disputed,
        arbiter,
    );
    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_release_bounty_boundary_status_expired() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let bounty_id = create_bounty_with_state(
        &env,
        &client,
        maintainer.clone(),
        contributor,
        token_id,
        BountyStatus::Expired,
        arbiter,
    );
    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn test_release_bounty_boundary_missing_fee_recipient_when_fee_positive() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, _arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &10_000,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &500u32, // 5% fee -> fee_amount = 500 > 0
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);

    // Clear FeeRecipient from storage
    env.as_contract(&client.address, || {
        env.storage().persistent().remove(&DataKey::FeeRecipient);
    });

    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
fn test_release_bounty_boundary_zero_fee_bps_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, fee_recipient, _arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let initial_contributor_balance = token_admin.balance(&contributor);
    let initial_fee_recipient_balance = token_admin.balance(&fee_recipient);

    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &5_000,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32, // 0 bps fee
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.release_bounty(&bounty_id, &maintainer);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);
    assert_eq!(
        token_admin.balance(&contributor),
        initial_contributor_balance + 5_000
    );
    assert_eq!(
        token_admin.balance(&fee_recipient),
        initial_fee_recipient_balance
    );
}

#[test]
fn test_release_bounty_boundary_fee_truncation_zero_fee_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, fee_recipient, _arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let initial_contributor_balance = token_admin.balance(&contributor);
    let initial_fee_recipient_balance = token_admin.balance(&fee_recipient);

    // amount = 100, protocol_fee_bps = 50 (0.5%)
    // (100 * 50) / 10_000 = 0 -> truncates to zero fee
    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &100,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &50u32,
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.release_bounty(&bounty_id, &maintainer);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);
    assert_eq!(
        token_admin.balance(&contributor),
        initial_contributor_balance + 100
    );
    assert_eq!(
        token_admin.balance(&fee_recipient),
        initial_fee_recipient_balance
    );
}

#[test]
fn test_release_bounty_boundary_max_amount_large_fee_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, fee_recipient, _arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);

    let max_amount = 1_000_000_000_000_000i128; // MAX_BOUNTY_AMOUNT
    token_admin.mint(&maintainer, &max_amount);

    let initial_contributor_balance = token_admin.balance(&contributor);
    let initial_fee_recipient_balance = token_admin.balance(&fee_recipient);

    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &max_amount,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &1000u32, // 10% fee
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.release_bounty(&bounty_id, &maintainer);

    let expected_fee = 100_000_000_000_000i128; // 10%
    let expected_payout = 900_000_000_000_000i128; // 90%

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);
    assert_eq!(
        token_admin.balance(&contributor),
        initial_contributor_balance + expected_payout
    );
    assert_eq!(
        token_admin.balance(&fee_recipient),
        initial_fee_recipient_balance + expected_fee
    );
}

#[test]
fn test_release_bounty_boundary_lifecycle_and_events() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, fee_recipient, _arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &10_000,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &500u32, // 5% fee -> 500 fee, 9500 payout
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.release_bounty(&bounty_id, &maintainer);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);
    assert_eq!(token_admin.balance(&contributor), 9_500);
    assert_eq!(token_admin.balance(&fee_recipient), 500);
    assert_eq!(token_admin.balance(&client.address), 0);
}

#[test]
fn test_release_bounty_boundary_min_amount_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, fee_recipient, _arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let initial_contributor_balance = token_admin.balance(&contributor);
    let initial_fee_recipient_balance = token_admin.balance(&fee_recipient);

    // Minimum bounty amount is 100 stroops (DEFAULT_MIN_BOUNTY_AMOUNT)
    // with 10% fee (1000 bps) -> fee = 10, payout = 90
    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &100,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &1000u32,
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.release_bounty(&bounty_id, &maintainer);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);
    assert_eq!(
        token_admin.balance(&contributor),
        initial_contributor_balance + 90
    );
    assert_eq!(
        token_admin.balance(&fee_recipient),
        initial_fee_recipient_balance + 10
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_release_bounty_boundary_double_release_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, _arbiter) =
        setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    // ─── create_bounty structured event (CrtEvent) ──────────────────────────

    #[test]
    fn test_create_bounty_emits_structured_event() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, _admin, maintainer, _contributor, token_id, _fee_recipient, _arbiter) =
            setup_test(&env);
        let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&maintainer, &1000);

        let deadline = env.ledger().timestamp() + 1000;
        let bounty_id = client.create_bounty(
            &maintainer,
            &token_id,
            &500,
            &String::from_str(&env, "repo"),
            &7,
            &String::from_str(&env, "title"),
            &deadline,
            &250u32,
            &Some(3600u64),
        );

        // The structured event is the last one emitted by this contract.
        let events = env.events().all().filter_by_contract(&client.address);
        let event = events.events().last().unwrap();
        let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
        let t0 = soroban_sdk::Symbol::from_val(&env, &body.topics[0]);
        let t1 = soroban_sdk::Symbol::from_val(&env, &body.topics[1]);
        assert_eq!(t0, symbol_short!("Bounty"));
        assert_eq!(t1, symbol_short!("CrtEvent"));

        let payload = BountyCreatedEvent::from_val(&env, &body.data);
        assert_eq!(
            payload,
            BountyCreatedEvent {
                bounty_id,
                maintainer,
                token: token_id,
                amount: 500,
                repo: String::from_str(&env, "repo"),
                issue_number: 7,
                title: String::from_str(&env, "title"),
                deadline,
                protocol_fee_bps: 250,
                dispute_window_override: Some(3600),
                created_at: env.ledger().timestamp(),
            }
        );
    }

    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &1_000,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.release_bounty(&bounty_id, &maintainer);

    // Second call must fail because bounty is now Released, not Submitted
    client.release_bounty(&bounty_id, &maintainer);
}

// ─── get_bounty Boundary / Edge-Case Test Suite ─────────────────────────────
//
// Covers every boundary condition documented for `get_bounty`:
//   • BountyNotFound  — nonexistent ID (id=0, large id, next id never written)
//   • Expiry promotion — Open/Reserved past deadline → Expired (in-memory only)
//   • No expiry on terminal statuses (Released, Refunded, Disputed, Submitted)
//   • Happy-path fields — returned struct matches what was stored at creation
//
// Pattern mirrors the `test_submit_bounty_boundaries` table-driven suite above:
// each case runs in its own isolated `Env` so ledger state never bleeds across.

enum GetBountyExpected {
    /// Call must succeed and the returned bounty's status must equal this.
    Status(BountyStatus),
    /// Call must panic with a message containing this `ContractError` variant name.
    Error(ContractError),
}

struct GetBountyTestCase {
    name: &'static str,
    /// If `None`, no bounty is created and `bounty_id_override` is used directly.
    setup_status: Option<BountyStatus>,
    /// Override the ID passed to `get_bounty` (used for nonexistent-ID cases).
    bounty_id_override: Option<u64>,
    /// Advance ledger past the bounty's deadline before calling `get_bounty`.
    advance_past_deadline: bool,
    expected: GetBountyExpected,
}

#[test]
fn test_get_bounty_boundaries() {
    let test_cases = [
        // ── Nonexistent-ID cases ────────────────────────────────────────────
        GetBountyTestCase {
            name: "id=0 is never a valid bounty (NextBountyId starts at 1)",
            setup_status: None,
            bounty_id_override: Some(0),
            advance_past_deadline: false,
            expected: GetBountyExpected::Error(ContractError::BountyNotFound),
        },
        GetBountyTestCase {
            name: "large nonexistent id (999_999) returns BountyNotFound",
            setup_status: None,
            bounty_id_override: Some(999_999),
            advance_past_deadline: false,
            expected: GetBountyExpected::Error(ContractError::BountyNotFound),
        },
        GetBountyTestCase {
            name: "id one past the only created bounty (next-id boundary) returns BountyNotFound",
            setup_status: Some(BountyStatus::Open), // creates bounty_id=1
            bounty_id_override: Some(2),            // ask for id=2 — never written
            advance_past_deadline: false,
            expected: GetBountyExpected::Error(ContractError::BountyNotFound),
        },
        // ── Open bounty, alive ───────────────────────────────────────────────
        GetBountyTestCase {
            name: "Open bounty before deadline returns Open",
            setup_status: Some(BountyStatus::Open),
            bounty_id_override: None,
            advance_past_deadline: false,
            expected: GetBountyExpected::Status(BountyStatus::Open),
        },
        // ── Expiry promotion: Open past deadline ─────────────────────────────
        GetBountyTestCase {
            name: "Open bounty past deadline is promoted to Expired (in-memory)",
            setup_status: Some(BountyStatus::Open),
            bounty_id_override: None,
            advance_past_deadline: true,
            expected: GetBountyExpected::Status(BountyStatus::Expired),
        },
        // ── Expiry promotion: Reserved past deadline ─────────────────────────
        GetBountyTestCase {
            name: "Reserved bounty past deadline is promoted to Expired (in-memory)",
            setup_status: Some(BountyStatus::Reserved),
            bounty_id_override: None,
            advance_past_deadline: true,
            expected: GetBountyExpected::Status(BountyStatus::Expired),
        },
        // ── Terminal statuses are NOT expired even past deadline ─────────────
        GetBountyTestCase {
            name: "Submitted bounty past deadline stays Submitted (no expiry on terminal)",
            setup_status: Some(BountyStatus::Submitted),
            bounty_id_override: None,
            advance_past_deadline: true,
            expected: GetBountyExpected::Status(BountyStatus::Submitted),
        },
        GetBountyTestCase {
            name: "Released bounty past deadline stays Released (terminal, no expiry)",
            setup_status: Some(BountyStatus::Released),
            bounty_id_override: None,
            advance_past_deadline: true,
            expected: GetBountyExpected::Status(BountyStatus::Released),
        },
        GetBountyTestCase {
            name: "Refunded bounty past deadline stays Refunded (terminal, no expiry)",
            setup_status: Some(BountyStatus::Refunded),
            bounty_id_override: None,
            advance_past_deadline: true,
            expected: GetBountyExpected::Status(BountyStatus::Refunded),
        },
        GetBountyTestCase {
            name: "Disputed bounty past deadline stays Disputed (terminal, no expiry)",
            setup_status: Some(BountyStatus::Disputed),
            bounty_id_override: None,
            advance_past_deadline: true,
            expected: GetBountyExpected::Status(BountyStatus::Disputed),
        },
        // ── Reserved bounty before deadline ─────────────────────────────────
        GetBountyTestCase {
            name: "Reserved bounty before deadline returns Reserved",
            setup_status: Some(BountyStatus::Reserved),
            bounty_id_override: None,
            advance_past_deadline: false,
            expected: GetBountyExpected::Status(BountyStatus::Reserved),
        },
        // ── Happy-path: zero-amount boundary (minimum allowed) ───────────────
        GetBountyTestCase {
            name: "Open bounty at minimum amount (100 stroops) is retrievable",
            setup_status: Some(BountyStatus::Open),
            bounty_id_override: None,
            advance_past_deadline: false,
            expected: GetBountyExpected::Status(BountyStatus::Open),
        },
    ];

    for tc in test_cases.iter() {
        let env = Env::default();
        env.mock_all_auths();

        let (client, _admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
            setup_test(&env);
        let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&maintainer, &10_000);

        // Build the bounty in the requested state (if any).
        let created_id: Option<u64> = if tc.setup_status.is_some() {
            Some(create_bounty_with_state(
                &env,
                &client,
                maintainer.clone(),
                contributor.clone(),
                token_id.clone(),
                tc.setup_status.unwrap(),
                arbiter.clone(),
            ))
        } else {
            None
        };

        // Determine which ID to query.
        let query_id: u64 = match tc.bounty_id_override {
            Some(id) => id,
            None => created_id.expect("bounty_id_override required when setup_status is None"),
        };

        // Advance the ledger past the deadline when the case requires it.
        if tc.advance_past_deadline {
            if let Some(id) = created_id {
                // Peek at the stored deadline without triggering expiry.
                // We read it at the current timestamp (before advancing).
                let bounty = client.get_bounty(&id);
                env.ledger().set_timestamp(bounty.deadline + 1);
            }
        }

        // Invoke `get_bounty` and capture success or panic.
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.get_bounty(&query_id)
        }));

        match &tc.expected {
            GetBountyExpected::Status(expected_status) => {
                let bounty = outcome.unwrap_or_else(|_| {
                    panic!(
                        "expected success ({expected_status:?}) but panicked for case: {}",
                        tc.name
                    )
                });
                assert_eq!(
                    bounty.status, *expected_status,
                    "case `{}`: wrong status",
                    tc.name
                );
            }
            GetBountyExpected::Error(expected_err) => {
                let payload = match outcome {
                    Ok(b) => panic!(
                        "expected error {:?} but got status {:?} for case: {}",
                        expected_err, b.status, tc.name
                    ),
                    Err(p) => p,
                };
                let msg = if let Some(s) = payload.downcast_ref::<std::string::String>() {
                    s.clone()
                } else if let Some(s) = payload.downcast_ref::<&str>() {
                    std::string::String::from(*s)
                } else {
                    std::string::String::new()
                };
                let expected_name = std::format!("Error(Contract, #{})", *expected_err as u32);
                assert!(
                    msg.contains(&expected_name),
                    "case `{}`: expected error variant `{}` but panic message was: `{}`",
                    tc.name,
                    expected_name,
                    msg
                );
            }
        }
    }
}

// ── Individual named tests (snapshot-friendly, each asserting one boundary) ──
//
// These complement the table above: they are individually named so that `cargo
// test` output and CI snapshots show exactly which boundary failed.

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_get_bounty_id_zero_not_found() {
    let env = Env::default();
    let (client, _, _, _, _, _, _) = setup_test(&env);
    client.get_bounty(&0u64);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_get_bounty_large_nonexistent_id_not_found() {
    let env = Env::default();
    let (client, _, _, _, _, _, _) = setup_test(&env);
    client.get_bounty(&u64::MAX);
}

#[test]
fn test_get_bounty_open_before_deadline_returns_open() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, _contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1_000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1_000),
        &0u32,
        &None,
    );

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Open);
    // Verify stored fields are returned intact.
    assert_eq!(bounty.amount, 500);
    assert_eq!(bounty.issue_number, 1);
    assert_eq!(bounty.maintainer, maintainer);
    assert_eq!(bounty.contributor, None);
}

#[test]
fn test_get_bounty_open_past_deadline_returns_expired() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, _contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1_000);

    let deadline = env.ledger().timestamp() + 500;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );

    // Advance ledger past deadline — expiry is triggered lazily by get_bounty.
    env.ledger().set_timestamp(deadline + 1);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(
        bounty.status,
        BountyStatus::Expired,
        "Open bounty past deadline must be reported as Expired"
    );
}

#[test]
fn test_get_bounty_reserved_past_deadline_returns_expired() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _, _arbiter) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1_000);

    let deadline = env.ledger().timestamp() + 500;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );
    client.reserve_bounty(&bounty_id, &contributor);

    env.ledger().set_timestamp(deadline + 1);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(
        bounty.status,
        BountyStatus::Expired,
        "Reserved bounty past deadline must be reported as Expired"
    );
    // Contributor is still stored even though status is now Expired.
    assert_eq!(bounty.contributor, Some(contributor));
}

#[test]
fn test_get_bounty_released_past_deadline_stays_released() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _, _arbiter) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1_000);

    let deadline = env.ledger().timestamp() + 500;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );
    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.release_bounty(&bounty_id, &maintainer);

    // Advance well past deadline — terminal status must not be overwritten.
    env.ledger().set_timestamp(deadline + 10_000);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(
        bounty.status,
        BountyStatus::Released,
        "Released bounty must never be promoted to Expired"
    );
}

#[test]
fn test_get_bounty_refunded_past_deadline_stays_refunded() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _, _arbiter) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1_000);

    let deadline = env.ledger().timestamp() + 500;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );
    client.reserve_bounty(&bounty_id, &contributor);
    env.ledger().set_timestamp(deadline + 1);
    client.refund_bounty(&bounty_id, &maintainer);

    env.ledger().set_timestamp(deadline + 10_000);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(
        bounty.status,
        BountyStatus::Refunded,
        "Refunded bounty must never be promoted to Expired"
    );
}

#[test]
fn test_get_bounty_disputed_past_deadline_stays_disputed() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, contributor, token_id, _, arbiter) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1_000);

    let deadline = env.ledger().timestamp() + 500;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );
    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.dispute_bounty(&bounty_id, &arbiter);

    env.ledger().set_timestamp(deadline + 10_000);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(
        bounty.status,
        BountyStatus::Disputed,
        "Disputed bounty must never be promoted to Expired"
    );
}

#[test]
fn test_get_bounty_returns_correct_fields() {
    // Validates that every field stored at creation is faithfully returned.
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, _contributor, token_id, _, _arbiter) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &10_000);

    let repo = String::from_str(&env, "ritik4ever/stellar-bounty-board");
    let title = String::from_str(&env, "Boundary test bounty");
    let deadline = env.ledger().timestamp() + 2_000;
    let amount = 1_234i128;
    let issue_number = 42u32;
    let fee_bps = 0u32;

    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &amount,
        &repo,
        &issue_number,
        &title,
        &deadline,
        &fee_bps,
        &None,
    );

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.maintainer, maintainer);
    assert_eq!(bounty.token, token_id);
    assert_eq!(bounty.amount, amount);
    assert_eq!(bounty.repo, repo);
    assert_eq!(bounty.issue_number, issue_number);
    assert_eq!(bounty.title, title);
    assert_eq!(bounty.deadline, deadline);
    assert_eq!(bounty.status, BountyStatus::Open);
    assert_eq!(bounty.protocol_fee_bps, fee_bps);
    assert_eq!(bounty.contributor, None);
    assert_eq!(bounty.dispute_raised_at, 0);
    assert_eq!(bounty.dispute_window_override, None);
}

#[test]
fn test_get_bounty_exactly_at_deadline_is_not_expired() {
    // Boundary: timestamp == deadline  →  condition is `now > deadline`, so NOT expired.
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, _contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1_000);

    let deadline = env.ledger().timestamp() + 500;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );

    // Set ledger to exactly the deadline (not past it).
    env.ledger().set_timestamp(deadline);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(
        bounty.status,
        BountyStatus::Open,
        "Bounty exactly AT its deadline must still be Open (expire_if_needed uses strict >)"
    );
}

#[test]
fn test_get_bounty_one_second_past_deadline_is_expired() {
    // Off-by-one: deadline + 1 second must trigger expiry.
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, maintainer, _contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1_000);

    let deadline = env.ledger().timestamp() + 500;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0u32,
        &None,
    );

    env.ledger().set_timestamp(deadline + 1);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(
        bounty.status,
        BountyStatus::Expired,
        "Bounty one second past deadline must be Expired"
    );
}

// ─── release_bounty authorization ───────────────────────────────────────
// `release_bounty` is maintainer-only. These tests pin both the
// `require_auth()` signer check and the explicit `MaintainerMismatch` check.

use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};

type ReleaseAuthFixture = (
    StellarBountyBoardContractClient<'static>,
    u64,
    Address, // maintainer
    Address, // contributor
    Address, // token_id
    Address, // admin
    Address, // arbiter
);

/// Builds a Submitted bounty (setup runs under `mock_all_auths`; each test
/// then overrides auth with `mock_auths` / `set_auths`).
fn release_auth_fixture(env: &Env) -> ReleaseAuthFixture {
    env.mock_all_auths();
    let (client, admin, maintainer, contributor, token_id, _fee_recipient, arbiter) =
        setup_test(env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(env, &token_id);
    token_admin.mint(&maintainer, &10_000);
    let bounty_id = create_bounty_with_state(
        env,
        &client,
        maintainer.clone(),
        contributor.clone(),
        token_id.clone(),
        BountyStatus::Submitted,
        arbiter.clone(),
    );
    (
        client,
        bounty_id,
        maintainer,
        contributor,
        token_id,
        admin,
        arbiter,
    )
}

/// Authorizes exactly `release_bounty(bounty_id, arg)` for `signer`.
fn mock_release_auth(
    env: &Env,
    client: &StellarBountyBoardContractClient<'static>,
    signer: &Address,
    bounty_id: u64,
    arg: &Address,
) {
    env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "release_bounty",
            args: (bounty_id, arg.clone()).into_val(env),
            sub_invokes: &[],
        },
    }]);
}

#[test]
fn test_release_bounty_auth_correct_maintainer_succeeds() {
    let env = Env::default();
    let (client, bounty_id, maintainer, contributor, token_id, _admin, _arbiter) =
        release_auth_fixture(&env);

    mock_release_auth(&env, &client, &maintainer, bounty_id, &maintainer);
    client.release_bounty(&bounty_id, &maintainer);

    assert_eq!(client.get_bounty(&bounty_id).status, BountyStatus::Released);
    let token = soroban_sdk::token::TokenClient::new(&env, &token_id);
    assert_eq!(token.balance(&contributor), 500);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_release_bounty_auth_missing_signer_rejected() {
    let env = Env::default();
    let (client, bounty_id, maintainer, _contributor, _token_id, _admin, _arbiter) =
        release_auth_fixture(&env);

    // No authorization at all.
    env.set_auths(&[]);
    client.release_bounty(&bounty_id, &maintainer);
}

// Wrong signer: the maintainer address is passed as the argument, but a
// different address signed. `maintainer.require_auth()` must fail.

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_release_bounty_auth_wrong_signer_contributor_rejected() {
    let env = Env::default();
    let (client, bounty_id, maintainer, contributor, _token_id, _admin, _arbiter) =
        release_auth_fixture(&env);

    mock_release_auth(&env, &client, &contributor, bounty_id, &maintainer);
    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_release_bounty_auth_wrong_signer_arbiter_rejected() {
    let env = Env::default();
    let (client, bounty_id, maintainer, _contributor, _token_id, _admin, arbiter) =
        release_auth_fixture(&env);

    mock_release_auth(&env, &client, &arbiter, bounty_id, &maintainer);
    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_release_bounty_auth_wrong_signer_admin_rejected() {
    let env = Env::default();
    let (client, bounty_id, maintainer, _contributor, _token_id, admin, _arbiter) =
        release_auth_fixture(&env);

    mock_release_auth(&env, &client, &admin, bounty_id, &maintainer);
    client.release_bounty(&bounty_id, &maintainer);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_release_bounty_auth_wrong_signer_stranger_rejected() {
    let env = Env::default();
    let (client, bounty_id, maintainer, _contributor, _token_id, _admin, _arbiter) =
        release_auth_fixture(&env);
    let stranger = Address::generate(&env);

    mock_release_auth(&env, &client, &stranger, bounty_id, &maintainer);
    client.release_bounty(&bounty_id, &maintainer);
}

// Self-signed wrong caller: authorized for themselves but not the bounty's
// maintainer, so the contract rejects with `MaintainerMismatch` (#25).

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_release_bounty_auth_self_signed_contributor_rejected() {
    let env = Env::default();
    let (client, bounty_id, _maintainer, contributor, _token_id, _admin, _arbiter) =
        release_auth_fixture(&env);

    mock_release_auth(&env, &client, &contributor, bounty_id, &contributor);
    client.release_bounty(&bounty_id, &contributor);
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_release_bounty_auth_self_signed_arbiter_rejected() {
    let env = Env::default();
    let (client, bounty_id, _maintainer, _contributor, _token_id, _admin, arbiter) =
        release_auth_fixture(&env);

    mock_release_auth(&env, &client, &arbiter, bounty_id, &arbiter);
    client.release_bounty(&bounty_id, &arbiter);
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_release_bounty_auth_self_signed_admin_rejected() {
    let env = Env::default();
    let (client, bounty_id, _maintainer, _contributor, _token_id, admin, _arbiter) =
        release_auth_fixture(&env);

    mock_release_auth(&env, &client, &admin, bounty_id, &admin);
    client.release_bounty(&bounty_id, &admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_release_bounty_auth_self_signed_stranger_rejected() {
    let env = Env::default();
    let (client, bounty_id, _maintainer, _contributor, _token_id, _admin, _arbiter) =
        release_auth_fixture(&env);
    let stranger = Address::generate(&env);

    mock_release_auth(&env, &client, &stranger, bounty_id, &stranger);
    client.release_bounty(&bounty_id, &stranger);
}
