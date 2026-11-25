//! Focused tests for contract submission event fields, ordering, and unchanged
//! balance invariant (SBB-2026-419).
//!
//! Verifies that a committed, authorized `submit_bounty` call emits:
//! 1. `("Bounty", "Submit")` (`BountySubmitted`) — as the sole contract event
//!
//! with deterministic payload fields (`bounty_id`, `contributor`), zero
//! `("Escrow", "Balance")` events, zero token transfer events, strictly
//! unchanged token balances, and zero events on failed or duplicate calls.
//! All tests use mock Soroban token contracts and never use live funds.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    xdr::{ContractEventBody, ScVal},
    Address, Env, FromVal, Map, String, Symbol, TryFromVal, Val,
};
use stellar_bounty_board::{
    BountyStatus, BountySubmitted, ContractError, StellarBountyBoardContract,
    StellarBountyBoardContractClient,
};

struct SubmissionFixture<'a> {
    client: StellarBountyBoardContractClient<'a>,
    maintainer: Address,
    contributor: Address,
    fee_recipient: Address,
    outsider: Address,
    token_id: Address,
}

fn setup<'a>(env: &'a Env) -> SubmissionFixture<'a> {
    env.mock_all_auths();

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let fee_recipient = Address::generate(env);
    let arbiter = Address::generate(env);
    client.initialize(&admin, &fee_recipient, &arbiter, &3_600);

    let token_admin = Address::generate(env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let maintainer = Address::generate(env);
    let contributor = Address::generate(env);
    let outsider = Address::generate(env);
    StellarAssetClient::new(env, &token_id).mint(&maintainer, &1_000_000);

    SubmissionFixture {
        client,
        maintainer,
        contributor,
        fee_recipient,
        outsider,
        token_id,
    }
}

fn create_and_reserve(
    env: &Env,
    fx: &SubmissionFixture<'_>,
    amount: i128,
    deadline: u64,
) -> u64 {
    let id = fx.client.create_bounty(
        &fx.maintainer,
        &fx.token_id,
        &amount,
        &String::from_str(env, "org/repo"),
        &419,
        &String::from_str(env, "Submission event test"),
        &deadline,
        &250,
        &None,
    );
    fx.client.reserve_bounty(&id, &fx.contributor);
    id
}

fn contract_event_count(env: &Env, contract_addr: &Address) -> usize {
    env.events()
        .all()
        .filter_by_contract(contract_addr)
        .events()
        .len()
}

fn contract_events_since(
    env: &Env,
    contract_addr: &Address,
    start_idx: usize,
) -> std::vec::Vec<((Symbol, Symbol), ScVal)> {
    let filtered = env.events().all().filter_by_contract(contract_addr);
    let mut out = std::vec::Vec::new();
    for event in filtered.events().iter().skip(start_idx) {
        let ContractEventBody::V0(body) = &event.body;
        assert_eq!(body.topics.len(), 2, "expected 2-topic contract event");
        let domain = Symbol::from_val(env, &body.topics[0]);
        let action = Symbol::from_val(env, &body.topics[1]);
        out.push(((domain, action), body.data.clone()));
    }
    out
}

#[test]
fn authorized_submission_emits_single_ordered_event_and_leaves_balances_unchanged() {
    let env = Env::default();
    env.ledger().set_timestamp(10_000);
    let fx = setup(&env);
    let escrow_amount: i128 = 123_456;
    let deadline = 11_000;
    let id = create_and_reserve(&env, &fx, escrow_amount, deadline);

    let token = TokenClient::new(&env, &fx.token_id);
    let escrow_before = token.balance(&fx.client.address);
    let maintainer_before = token.balance(&fx.maintainer);
    let contributor_before = token.balance(&fx.contributor);
    let fee_recipient_before = token.balance(&fx.fee_recipient);
    assert_eq!(escrow_before, escrow_amount);

    env.ledger().set_timestamp(10_500);
    let before_contract_events = contract_event_count(&env, &fx.client.address);
    let before_token_events = contract_event_count(&env, &fx.token_id);

    fx.client.submit_bounty(&id, &fx.contributor);

    // Exactly 1 contract event emitted, and 0 token transfer events.
    let events = contract_events_since(&env, &fx.client.address, before_contract_events);
    assert_eq!(
        events.len(),
        1,
        "committed submission must emit exactly 1 contract event"
    );
    assert_eq!(
        contract_event_count(&env, &fx.token_id),
        before_token_events,
        "submission must not emit any token transfer events"
    );

    // 1. ("Bounty", "Submit") — BountySubmitted
    assert_eq!(
        events[0].0,
        (symbol_short!("Bounty"), symbol_short!("Submit"))
    );

    let payload_map = Map::<Symbol, Val>::from_val(&env, &events[0].1);
    assert_eq!(payload_map.len(), 2, "BountySubmitted must have 2 fields");
    assert_eq!(
        u64::try_from_val(
            &env,
            &payload_map.get(Symbol::new(&env, "bounty_id")).unwrap()
        )
        .unwrap(),
        id
    );
    assert_eq!(
        Address::try_from_val(
            &env,
            &payload_map.get(Symbol::new(&env, "contributor")).unwrap()
        )
        .unwrap(),
        fx.contributor
    );

    let submitted = BountySubmitted::from_val(&env, &events[0].1);
    assert_eq!(
        submitted,
        BountySubmitted {
            bounty_id: id,
            contributor: fx.contributor.clone(),
        }
    );

    // State transitioned to Submitted and balances are strictly unchanged.
    let bounty = fx.client.get_bounty(&id);
    assert_eq!(bounty.status, BountyStatus::Submitted);
    assert_eq!(bounty.contributor, Some(fx.contributor.clone()));

    assert_eq!(token.balance(&fx.client.address), escrow_before);
    assert_eq!(token.balance(&fx.maintainer), maintainer_before);
    assert_eq!(token.balance(&fx.contributor), contributor_before);
    assert_eq!(token.balance(&fx.fee_recipient), fee_recipient_before);
}

#[test]
fn submission_at_exact_deadline_emits_single_event_with_unchanged_balance() {
    let env = Env::default();
    env.ledger().set_timestamp(20_000);
    let fx = setup(&env);
    let escrow_amount: i128 = 54_321;
    let deadline = 20_500;
    let id = create_and_reserve(&env, &fx, escrow_amount, deadline);

    let token = TokenClient::new(&env, &fx.token_id);
    env.ledger().set_timestamp(deadline);
    let before_count = contract_event_count(&env, &fx.client.address);

    fx.client.submit_bounty(&id, &fx.contributor);

    let events = contract_events_since(&env, &fx.client.address, before_count);
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].0,
        (symbol_short!("Bounty"), symbol_short!("Submit"))
    );
    assert_eq!(
        BountySubmitted::from_val(&env, &events[0].1),
        BountySubmitted {
            bounty_id: id,
            contributor: fx.contributor.clone(),
        }
    );
    assert_eq!(token.balance(&fx.client.address), escrow_amount);
    assert_eq!(token.balance(&fx.contributor), 0);
}

#[test]
fn rejected_and_duplicate_submissions_emit_zero_events_and_preserve_balances() {
    let env = Env::default();
    env.ledger().set_timestamp(30_000);
    let fx = setup(&env);
    let token = TokenClient::new(&env, &fx.token_id);
    let escrow_amount: i128 = 10_000;
    let deadline = 31_000;
    let id = create_and_reserve(&env, &fx, escrow_amount, deadline);

    // 1. Unauthorized/mismatched callers emit 0 events.
    for caller in [&fx.outsider, &fx.maintainer] {
        let before = contract_event_count(&env, &fx.client.address);
        let err = fx.client.try_submit_bounty(&id, caller);
        assert_eq!(
            err,
            Err(Ok(soroban_sdk::Error::from_contract_error(
                ContractError::ContributorMismatch as u32
            )))
        );
        assert_eq!(
            contract_events_since(&env, &fx.client.address, before).len(),
            0
        );
        assert_eq!(token.balance(&fx.client.address), escrow_amount);
    }

    // 2. First authorized submission commits once (1 event).
    let before_commit = contract_event_count(&env, &fx.client.address);
    fx.client.submit_bounty(&id, &fx.contributor);
    assert_eq!(
        contract_events_since(&env, &fx.client.address, before_commit).len(),
        1
    );
    assert_eq!(token.balance(&fx.client.address), escrow_amount);

    // 3. Duplicate submission fails with BountyMustBeReserved and emits 0 events.
    let before_dup = contract_event_count(&env, &fx.client.address);
    let dup_err = fx.client.try_submit_bounty(&id, &fx.contributor);
    assert_eq!(
        dup_err,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            ContractError::BountyMustBeReserved as u32
        )))
    );
    assert_eq!(
        contract_events_since(&env, &fx.client.address, before_dup).len(),
        0
    );
    assert_eq!(token.balance(&fx.client.address), escrow_amount);

    // 4. Expired submission fails with BountyExpired and emits 0 events.
    let id_exp = create_and_reserve(&env, &fx, escrow_amount, deadline);
    env.ledger().set_timestamp(deadline + 1);
    let before_exp = contract_event_count(&env, &fx.client.address);
    let exp_err = fx.client.try_submit_bounty(&id_exp, &fx.contributor);
    assert_eq!(
        exp_err,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            ContractError::BountyExpired as u32
        )))
    );
    assert_eq!(
        contract_events_since(&env, &fx.client.address, before_exp).len(),
        0
    );
    assert_eq!(token.balance(&fx.client.address), escrow_amount * 2);

    // 5. Open (non-reserved) bounty submission fails with BountyMustBeReserved and emits 0 events.
    let id_open = fx.client.create_bounty(
        &fx.maintainer,
        &fx.token_id,
        &escrow_amount,
        &String::from_str(&env, "org/repo"),
        &420,
        &String::from_str(&env, "Open bounty submit test"),
        &(deadline + 500),
        &0,
        &None,
    );
    let before_open = contract_event_count(&env, &fx.client.address);
    let open_err = fx.client.try_submit_bounty(&id_open, &fx.contributor);
    assert_eq!(
        open_err,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            ContractError::BountyMustBeReserved as u32
        )))
    );
    assert_eq!(
        contract_events_since(&env, &fx.client.address, before_open).len(),
        0
    );
    assert_eq!(token.balance(&fx.client.address), escrow_amount * 3);
}
