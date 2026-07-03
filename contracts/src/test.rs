#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    Address, Env, IntoVal, String,
};

// ─── Version Tests ──────────────────────────────────────────────────────────

#[test]
fn test_get_version_matches_cargo_toml() {
    let env = Env::default();
    let contract_id = env.register_contract(None, StellarBountyBoardContract);
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let version = client.get_version();
    let expected = env!("CARGO_PKG_VERSION");

    assert_eq!(
        version.to_string(),
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

    let events = env.events().all();
    let cancel_event = events.last().unwrap();
    assert_eq!(
        cancel_event,
        (
            client.address.clone(),
            (symbol_short!("Bounty"), symbol_short!("Cancel")).into_val(&env),
            BountyCanceled {
                bounty_id,
                maintainer: maintainer.clone(),
                amount: 500,
            }
            .into_val(&env)
        )
    );
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
fn test_update_metadata_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, _, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let deadline = env.ledger().timestamp() + 1000;
    let old_title = String::from_str(&env, "Old Title");
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &old_title,
        &deadline,
        &0u32,
    );

    let new_title = String::from_str(&env, "New Title");
    client.update_metadata(&bounty_id, &maintainer, &new_title);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.title, new_title);

    let events = env.events().all();
    let update_event = events.last().unwrap();
    assert_eq!(
        update_event,
        (
            client.address.clone(),
            (symbol_short!("Bounty"), symbol_short!("UpdMeta")).into_val(&env),
            BountyMetadataUpdated {
                bounty_id,
                old_title,
                new_title,
            }
            .into_val(&env)
        )
    );
}

#[test]
#[should_panic(expected = "MaintainerMismatch")]
fn test_update_metadata_wrong_maintainer() {
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

    client.update_metadata(&bounty_id, &contributor, &String::from_str(&env, "New Title"));
}

invalid_transition_test!(
    update_metadata_released,
    BountyStatus::Released,
    "CannotUpdateFinalizedBounty",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| {
            client.update_metadata(
                &bounty_id,
                &maintainer,
                &String::from_str(&client.env, "New Title"),
            )
        }
    }
);
invalid_transition_test!(
    update_metadata_refunded,
    BountyStatus::Refunded,
    "CannotUpdateFinalizedBounty",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| {
            client.update_metadata(
                &bounty_id,
                &maintainer,
                &String::from_str(&client.env, "New Title"),
            )
        }
    }
);
invalid_transition_test!(
    update_metadata_expired,
    BountyStatus::Expired,
    "CannotUpdateFinalizedBounty",
    {
        |client: &StellarBountyBoardContractClient<'static>,
         bounty_id: u64,
         maintainer: Address,
         _contributor: Address| {
            client.update_metadata(
                &bounty_id,
                &maintainer,
                &String::from_str(&client.env, "New Title"),
            )
        }
    }
);
