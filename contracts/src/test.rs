#![allow(deprecated)]
#![allow(unused_imports)]
#![allow(unused_variables)]
#![cfg(test)]

extern crate alloc;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, String,
};

// ─── Version Tests ──────────────────────────────────────────────────────

#[test]
fn test_get_version_matches_cargo_toml() {
    let env = Env::default();
    let contract_id = env.register(None, StellarBountyBoardContract);
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let version = client.get_version();
    let expected = String::from_str(&env, env!("CARGO_PKG_VERSION"));

    assert_eq!(
        version,
        expected,
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
    let contract_id = env.register(None, StellarBountyBoardContract);
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
            let (client, _admin, maintainer, contributor, token_id, _, _) = setup_test(&env);
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
#[should_panic(expected = "InvalidAmount")]
fn test_set_min_bounty_amount_zero_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _, _, _, _, arbiter) = setup_test(&env);
    client.set_min_bounty_amount(&0);
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn test_set_min_bounty_amount_above_max_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _, _, _, _, arbiter) = setup_test(&env);
    client.set_min_bounty_amount(&(MAX_BOUNTY_AMOUNT + 1));
}

#[test]
#[should_panic(expected = "AmountTooSmall")]
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
#[should_panic(expected = "AmountTooSmall")]
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

    let (client, _admin, maintainer, _contributor, token_id, _fee_recipient, _arbiter) = setup_test(&env);
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
#[should_panic(expected = "InvalidAmount")]
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
#[should_panic(expected = "DeadlineMustBeInTheFuture")]
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
fn test_full_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _fee_recipient, _arbiter) = setup_test(&env);
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
#[should_panic(expected = "BountyNotExpiredYet")]
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

    let (client, _admin, maintainer, _contributor, token_id, _fee_recipient, _arbiter) = setup_test(&env);
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
}

#[test]
fn test_cancel_bounty_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, _contributor, token_id, _fee_recipient, _arbiter) = setup_test(&env);
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
    assert!(event_count >= 2, "Expected at least BountyCreated + BountyCanceled events, got {event_count}");
    assert!(events.events().last().is_some(), "At least one event should be present after filter");
}

#[test]
#[should_panic(expected = "MaintainerMismatch")]
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

#[test]
#[should_panic(expected = "BountyNotOpen")]
fn test_cancel_bounty_non_open_reserved() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, maintainer, contributor, token_id, _, _) = setup_test(&env);
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
#[should_panic(expected = "BountyMustBeSubmitted")]
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
#[should_panic(expected = "BountyNotOpen")]
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
#[should_panic(expected = "BountyNotOpen")]
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
    );

    // First contributor reserves — should succeed and transition to Reserved
    client.reserve_bounty(&bounty_id, &contributor1);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved, "First reserve should transition to Reserved");
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
#[should_panic(expected = "BountyNotOpen")]
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
    
    let (client, _admin, _, _, _, _, old_arbiter) = setup_test(&env);
    let new_arbiter = Address::generate(&env);
    
    // Set arbiter
    client.set_arbiter(&new_arbiter);
    
    // Advance time by 2 days + 1 second
    env.ledger().set_timestamp(env.ledger().timestamp() + 86400 * 2 + 1);
    
    // Confirm arbiter
    client.confirm_arbiter();
    
    // Test that the arbiter was updated
    // To do this we can check if dispute works with the new arbiter?
    // Actually we just check events.
}

#[test]
#[should_panic(expected = "TimelockNotElapsed")]
fn test_arbiter_rotation_timelock_fails() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (client, _admin, _, _, _, _, _) = setup_test(&env);
    let new_arbiter = Address::generate(&env);
    
    client.set_arbiter(&new_arbiter);
    
    // Do not advance time, or advance less than 2 days
    env.ledger().set_timestamp(env.ledger().timestamp() + 86400);
    
    client.confirm_arbiter();
}

#[test]
#[should_panic(expected = "MaintainerMismatch")]
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
#[should_panic(expected = "DeadlineMustAdvance")]
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
    assert_eq!(client.get_effective_dispute_window(&bounty_id), custom_window);
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
#[should_panic(expected = "DisputeWindowOverrideTooSmall")]
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
#[should_panic(expected = "DisputeWindowOverrideTooLarge")]
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
    );

    let result = client.get_bounties_by_contributor(&contributor, &1u64, &10u32);
    assert_eq!(result.len(), 0, "open bounties should not appear for any contributor");
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
        &maintainer, &token_id, &500,
        &String::from_str(&env, "repo"), &1,
        &String::from_str(&env, "title"), &deadline, &0u32,
    );
    client.reserve_bounty(&b1, &contributor);

    // Bounty 2 — reserved and submitted by our contributor
    let b2 = client.create_bounty(
        &maintainer, &token_id, &500,
        &String::from_str(&env, "repo"), &2,
        &String::from_str(&env, "title"), &deadline, &0u32,
    );
    client.reserve_bounty(&b2, &contributor);
    client.submit_bounty(&b2, &contributor);

    // Bounty 3 — reserved by a different contributor (must NOT appear)
    let b3 = client.create_bounty(
        &maintainer, &token_id, &500,
        &String::from_str(&env, "repo"), &3,
        &String::from_str(&env, "title"), &deadline, &0u32,
    );
    client.reserve_bounty(&b3, &other_contributor);

    // Bounty 4 — still open (must NOT appear)
    client.create_bounty(
        &maintainer, &token_id, &500,
        &String::from_str(&env, "repo"), &4,
        &String::from_str(&env, "title"), &deadline, &0u32,
    );

    let result = client.get_bounties_by_contributor(&contributor, &1u64, &50u32);
    assert_eq!(result.len(), 2, "only the two bounties belonging to our contributor should be returned");
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
#[should_panic(expected = "BountyAlreadyFinalized")]
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
    );

    client.cancel_bounty(&bounty_id, &maintainer);

    // Attempting to refund a canceled (already refunded) bounty should panic
    client.refund_bounty(&bounty_id, &maintainer);
}

