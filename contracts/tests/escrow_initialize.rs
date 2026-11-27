//! Focused integration tests for escrow contract initialization and arbiter immutability.
//!
//! Verifies that:
//! - The first `initialize` call configures a valid arbiter and initial contract state
//!   without moving token balances or emitting spurious events.
//! - A second caller attempting to re-initialize and replace the arbiter is rejected,
//!   leaving the original arbiter identity, initialized state, authorization rules,
//!   token balances, and emitted events intact.

use soroban_sdk::{
    testutils::{Address as _, Events, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, FromVal, IntoVal, Symbol,
};
use stellar_bounty_board::{
    StellarBountyBoardContract, StellarBountyBoardContractClient, DEFAULT_MIN_BOUNTY_AMOUNT,
};

const DISPUTE_WINDOW: u64 = 600;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    admin: Address,
    fee_recipient: Address,
    arbiter: Address,
    token: Address,
    token_admin: Address,
}

fn setup_uninitialized() -> Fixture {
    let env = Env::default();
    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let arbiter = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    Fixture {
        env,
        client,
        admin,
        fee_recipient,
        arbiter,
        token,
        token_admin,
    }
}

fn mint_test_tokens(env: &Env, token: &Address, token_admin: &Address, to: &Address, amount: i128) {
    let sac = StellarAssetClient::new(env, token);
    let invoke = MockAuthInvoke {
        contract: token,
        fn_name: "mint",
        args: (to, &amount).into_val(env),
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: token_admin,
        invoke: &invoke,
    }]);
    sac.mint(to, &amount);
}

#[test]
fn first_initialize_sets_valid_arbiter_and_contract_state() {
    let f = setup_uninitialized();
    let token_client = TokenClient::new(&f.env, &f.token);

    // Seed isolated test balances (no live funds) to verify initialize moves no tokens.
    mint_test_tokens(&f.env, &f.token, &f.token_admin, &f.admin, 10_000);
    mint_test_tokens(&f.env, &f.token, &f.token_admin, &f.arbiter, 5_000);

    // Clear auths before calling initialize.
    f.env.mock_auths(&[]);

    f.client
        .initialize(&f.admin, &f.fee_recipient, &f.arbiter, &DISPUTE_WINDOW);

    // No events are emitted by initialize.
    assert_eq!(f.env.events().all().events().len(), 0);

    // Initialized contract state and arbiter identity.
    assert_eq!(f.client.get_arbiter(), f.arbiter);
    assert_eq!(f.client.get_fee_recipient(), f.fee_recipient);
    assert_eq!(f.client.get_min_bounty_amount(), DEFAULT_MIN_BOUNTY_AMOUNT);
    assert!(!f.client.get_paused_state());
    assert_eq!(f.client.get_next_bounty_id(), 0);

    // Balances remain untouched.
    assert_eq!(token_client.balance(&f.client.address), 0);
    assert_eq!(token_client.balance(&f.admin), 10_000);
    assert_eq!(token_client.balance(&f.arbiter), 5_000);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);

    // Authorization: configured arbiter can update min_bounty_amount.
    let new_min = 250i128;
    let invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "set_min_bounty_amount",
        args: (&new_min,).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.arbiter,
        invoke: &invoke,
    }]);
    f.client.set_min_bounty_amount(&new_min);
    assert_eq!(f.client.get_min_bounty_amount(), new_min);
}

#[test]
fn second_caller_cannot_replace_arbiter_via_reinitialize() {
    let f = setup_uninitialized();
    let token_client = TokenClient::new(&f.env, &f.token);

    let second_caller = Address::generate(&f.env);
    let second_fee_recipient = Address::generate(&f.env);
    let replacement_arbiter = Address::generate(&f.env);

    // Seed isolated test balances (no live funds).
    mint_test_tokens(&f.env, &f.token, &f.token_admin, &f.admin, 10_000);
    mint_test_tokens(&f.env, &f.token, &f.token_admin, &f.arbiter, 5_000);
    mint_test_tokens(&f.env, &f.token, &f.token_admin, &second_caller, 7_500);
    mint_test_tokens(
        &f.env,
        &f.token,
        &f.token_admin,
        &replacement_arbiter,
        2_500,
    );

    f.env.mock_auths(&[]);
    f.client
        .initialize(&f.admin, &f.fee_recipient, &f.arbiter, &DISPUTE_WINDOW);

    // Second caller attempts to re-initialize and replace the arbiter.
    let reinit_result = f.client.try_initialize(
        &second_caller,
        &second_fee_recipient,
        &replacement_arbiter,
        &1_200,
    );
    assert!(
        reinit_result.is_err(),
        "second initialize call must be rejected"
    );

    // No events were emitted by the rejected re-initialization.
    assert_eq!(f.env.events().all().events().len(), 0);

    // Arbiter identity and initialized contract state remain immutable.
    assert_eq!(f.client.get_arbiter(), f.arbiter);
    assert_ne!(f.client.get_arbiter(), replacement_arbiter);
    assert_eq!(f.client.get_fee_recipient(), f.fee_recipient);
    assert_eq!(f.client.get_min_bounty_amount(), DEFAULT_MIN_BOUNTY_AMOUNT);
    assert!(!f.client.get_paused_state());

    // No token balances changed.
    assert_eq!(token_client.balance(&f.client.address), 0);
    assert_eq!(token_client.balance(&f.admin), 10_000);
    assert_eq!(token_client.balance(&f.arbiter), 5_000);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
    assert_eq!(token_client.balance(&second_caller), 7_500);
    assert_eq!(token_client.balance(&replacement_arbiter), 2_500);

    // Authorization: replacement arbiter is rejected even with explicit MockAuth.
    let attempted_min = 500i128;
    let bad_invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "set_min_bounty_amount",
        args: (&attempted_min,).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &replacement_arbiter,
        invoke: &bad_invoke,
    }]);
    let auth_err = f.client.try_set_min_bounty_amount(&attempted_min);
    assert_eq!(
        auth_err,
        Err(Ok(Error::from((
            ScErrorType::Context,
            ScErrorCode::InvalidAction
        )))),
        "replacement arbiter must not gain arbiter authorization"
    );
    assert_eq!(f.client.get_min_bounty_amount(), DEFAULT_MIN_BOUNTY_AMOUNT);

    // Authorization: original arbiter still holds exclusive authority.
    let good_invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "set_min_bounty_amount",
        args: (&attempted_min,).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.arbiter,
        invoke: &good_invoke,
    }]);
    f.client.set_min_bounty_amount(&attempted_min);
    assert_eq!(f.client.get_min_bounty_amount(), attempted_min);
}

/// Returns true if any emitted event is an escrow funding event.
///
/// Funding events are the only observable signal that an escrow balance was
/// committed for a bounty ID. `initialize` must never produce them, so that
/// consumers can reconstruct a committed funding change exactly once.
fn has_escrow_funding_event(env: &Env) -> bool {
    let funding_topic_0 = Symbol::new(env, "Bounty");
    let funding_topic_1 = Symbol::new(env, "Fund");
    let escrow_balance_0 = Symbol::new(env, "Escrow");
    let escrow_balance_1 = Symbol::new(env, "Balance");
    for event in env.events().all().events().iter() {
        let soroban_sdk::xdr::ContractEventBody::V0(v0) = &event.body;
        if v0.topics.len() < 2 {
            continue;
        }
        let t0 = Symbol::from_val(env, &v0.topics[0]);
        let t1 = Symbol::from_val(env, &v0.topics[1]);
        if (t0 == funding_topic_0 && t1 == funding_topic_1)
            || (t0 == escrow_balance_0 && t1 == escrow_balance_1)
        {
            return true;
        }
    }
    false
}

#[test]
fn initialize_emits_no_escrow_funding_events_and_moves_no_tokens() {
    let f = setup_uninitialized();
    let token_client = TokenClient::new(&f.env, &f.token);

    // Seed isolated test balances (no live funds) so any token movement is visible.
    mint_test_tokens(&f.env, &f.token, &f.token_admin, &f.admin, 10_000);
    mint_test_tokens(&f.env, &f.token, &f.token_admin, &f.arbiter, 5_000);

    f.env.mock_auths(&[]);
    f.client
        .initialize(&f.admin, &f.fee_recipient, &f.arbiter, &DISPUTE_WINDOW);

    // No events at all, and specifically no escrow funding events.
    assert_eq!(f.env.events().all().events().len(), 0);
    assert!(
        !has_escrow_funding_event(&f.env),
        "initialize must not emit escrow funding events"
    );

    // No bounty ID was consumed, so no escrow balance can be attributed.
    assert_eq!(f.client.get_next_bounty_id(), 0);

    // No token balances moved into or out of the contract.
    assert_eq!(token_client.balance(&f.client.address), 0);
    assert_eq!(token_client.balance(&f.admin), 10_000);
    assert_eq!(token_client.balance(&f.arbiter), 5_000);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
}

/// Initialization must never fund an escrow: the minimum supported funding
/// amount boundary is enforced only when a bounty is created. This test pins
/// that contract so the funding boundary documentation stays consistent with
/// initialization behavior.
#[test]
fn initialize_does_not_fund_escrow_or_enforce_funding_boundary() {
    let f = setup_uninitialized();
    let token_client = TokenClient::new(&f.env, &f.token);

    // Seed isolated test balances (no live funds) at exact ledger/token units.
    mint_test_tokens(&f.env, &f.token, &f.token_admin, &f.admin, 10_000);

    f.env.mock_auths(&[]);
    f.client
        .initialize(&f.admin, &f.fee_recipient, &f.arbiter, &DISPUTE_WINDOW);

    // The minimum supported funding amount is exposed but not applied at init.
    let min_amount = f.client.get_min_bounty_amount();
    assert_eq!(min_amount, DEFAULT_MIN_BOUNTY_AMOUNT);
    assert!(min_amount > 0, "minimum funding amount must be positive");

    // No bounty ID was allocated, so no escrow balance can be attributed.
    assert_eq!(f.client.get_next_bounty_id(), 0);

    // No escrow balance exists for the contract and no tokens moved.
    assert_eq!(token_client.balance(&f.client.address), 0);
    assert_eq!(token_client.balance(&f.admin), 10_000);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);

    // No funding events were emitted by initialization.
    assert_eq!(f.env.events().all().events().len(), 0);
    assert!(
        !has_escrow_funding_event(&f.env),
        "initialize must not emit escrow funding events"
    );
}

#[test]
#[should_panic(expected = "already initialized")]
fn reinitialize_panics_with_already_initialized() {
    let f = setup_uninitialized();
    let second_caller = Address::generate(&f.env);
    let second_fee_recipient = Address::generate(&f.env);
    let replacement_arbiter = Address::generate(&f.env);

    f.client
        .initialize(&f.admin, &f.fee_recipient, &f.arbiter, &DISPUTE_WINDOW);

    // Must panic with "already initialized".
    f.client.initialize(
        &second_caller,
        &second_fee_recipient,
        &replacement_arbiter,
        &1_200,
    );
}
