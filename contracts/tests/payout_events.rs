//! Focused tests for contract payout event fields and ordering (SBB-2026-424).
//!
//! Verifies that a committed `release_bounty` call emits:
//! 1. `("Escrow", "Balance")` (`EscrowBalanceChanged`)
//! 2. `("Bounty", "Releas")` (`BountyReleased`)
//! 3. `("Bounty", "RelEvent")` (`BountyReleasedEvent`)
//!
//! in that exact order, with exact escrow amount conservation, deterministic
//! payload fields, and zero events on failed or duplicate invocations.
//! All tests use mock Soroban token contracts and never use live funds.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    xdr::{ContractEventBody, ScVal},
    Address, Env, FromVal, Map, String, Symbol, TryFromVal, Val,
};
use stellar_bounty_board::{
    BountyReleased, BountyReleasedEvent, BountyStatus, ContractError,
    StellarBountyBoardContract, StellarBountyBoardContractClient,
};

struct PayoutFixture<'a> {
    client: StellarBountyBoardContractClient<'a>,
    maintainer: Address,
    contributor: Address,
    fee_recipient: Address,
    token_id: Address,
}

fn setup<'a>(env: &'a Env) -> PayoutFixture<'a> {
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
    StellarAssetClient::new(env, &token_id).mint(&maintainer, &1_000_000);

    PayoutFixture {
        client,
        maintainer,
        contributor,
        fee_recipient,
        token_id,
    }
}

fn create_and_submit(
    env: &Env,
    fx: &PayoutFixture<'_>,
    amount: i128,
    protocol_fee_bps: u32,
) -> u64 {
    let deadline = env.ledger().timestamp() + 1_000;
    let id = fx.client.create_bounty(
        &fx.maintainer,
        &fx.token_id,
        &amount,
        &String::from_str(env, "org/repo"),
        &424,
        &String::from_str(env, "Payout event test"),
        &deadline,
        &protocol_fee_bps,
        &None,
    );
    fx.client.reserve_bounty(&id, &fx.contributor);
    fx.client.submit_bounty(&id, &fx.contributor);
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
fn payout_with_fee_emits_exact_ordered_events_and_conserves_escrow() {
    let env = Env::default();
    env.ledger().set_timestamp(10_000);
    let fx = setup(&env);
    let escrow_amount: i128 = 10_000;
    let fee_bps: u32 = 250; // 2.5% -> 250 fee, 9_750 net
    let id = create_and_submit(&env, &fx, escrow_amount, fee_bps);

    env.ledger().set_timestamp(10_500);
    let before_count = contract_event_count(&env, &fx.client.address);

    fx.client.release_bounty(&id, &fx.maintainer);

    let payout_events = contract_events_since(&env, &fx.client.address, before_count);
    assert_eq!(
        payout_events.len(),
        3,
        "committed payout must emit exactly 3 contract events"
    );

    // 1. ("Escrow", "Balance")
    assert_eq!(
        payout_events[0].0,
        (symbol_short!("Escrow"), symbol_short!("Balance"))
    );
    let escrow_map = Map::<Symbol, Val>::from_val(&env, &payout_events[0].1);
    assert_eq!(
        u64::try_from_val(&env, &escrow_map.get(Symbol::new(&env, "bounty_id")).unwrap()).unwrap(),
        id
    );
    assert_eq!(
        Address::try_from_val(&env, &escrow_map.get(Symbol::new(&env, "token")).unwrap()).unwrap(),
        fx.token_id
    );
    assert_eq!(
        i128::try_from_val(&env, &escrow_map.get(Symbol::new(&env, "amount")).unwrap()).unwrap(),
        escrow_amount
    );
    assert_eq!(
        i128::try_from_val(&env, &escrow_map.get(Symbol::new(&env, "delta")).unwrap()).unwrap(),
        -escrow_amount
    );
    assert_eq!(
        i128::try_from_val(&env, &escrow_map.get(Symbol::new(&env, "previous")).unwrap()).unwrap(),
        escrow_amount
    );
    assert_eq!(
        i128::try_from_val(&env, &escrow_map.get(Symbol::new(&env, "remaining")).unwrap()).unwrap(),
        0
    );
    assert_eq!(
        BountyStatus::try_from_val(&env, &escrow_map.get(Symbol::new(&env, "status")).unwrap())
            .unwrap(),
        BountyStatus::Released
    );

    // 2. ("Bounty", "Releas")
    assert_eq!(
        payout_events[1].0,
        (symbol_short!("Bounty"), symbol_short!("Releas"))
    );
    let released = BountyReleased::from_val(&env, &payout_events[1].1);
    assert_eq!(
        released,
        BountyReleased {
            bounty_id: id,
            contributor: fx.contributor.clone(),
            amount: 9_750,
            fee_amount: 250,
        }
    );
    assert_eq!(released.amount + released.fee_amount, escrow_amount);

    // 3. ("Bounty", "RelEvent")
    assert_eq!(
        payout_events[2].0,
        (symbol_short!("Bounty"), symbol_short!("RelEvent"))
    );
    let rel_event = BountyReleasedEvent::from_val(&env, &payout_events[2].1);
    assert_eq!(
        rel_event,
        BountyReleasedEvent {
            bounty_id: id,
            maintainer: fx.maintainer.clone(),
            contributor: fx.contributor.clone(),
            token: fx.token_id.clone(),
            amount: 9_750,
            fee_amount: 250,
            protocol_fee_bps: fee_bps,
            released_at: 10_500,
        }
    );
    assert_eq!(rel_event.amount + rel_event.fee_amount, escrow_amount);

    // Verify on-chain balances match the reconstructed payout events.
    let token = TokenClient::new(&env, &fx.token_id);
    assert_eq!(token.balance(&fx.client.address), 0);
    assert_eq!(token.balance(&fx.contributor), rel_event.amount);
    assert_eq!(token.balance(&fx.fee_recipient), rel_event.fee_amount);
}

#[test]
fn payout_with_zero_fee_emits_full_escrow_amount_to_contributor() {
    let env = Env::default();
    env.ledger().set_timestamp(20_000);
    let fx = setup(&env);
    let escrow_amount: i128 = 5_432;
    let id = create_and_submit(&env, &fx, escrow_amount, 0);

    env.ledger().set_timestamp(20_123);
    let before_count = contract_event_count(&env, &fx.client.address);

    fx.client.release_bounty(&id, &fx.maintainer);

    let payout_events = contract_events_since(&env, &fx.client.address, before_count);
    assert_eq!(payout_events.len(), 3);

    assert_eq!(
        payout_events[0].0,
        (symbol_short!("Escrow"), symbol_short!("Balance"))
    );
    assert_eq!(
        payout_events[1].0,
        (symbol_short!("Bounty"), symbol_short!("Releas"))
    );
    assert_eq!(
        payout_events[2].0,
        (symbol_short!("Bounty"), symbol_short!("RelEvent"))
    );

    let released = BountyReleased::from_val(&env, &payout_events[1].1);
    assert_eq!(released.amount, escrow_amount);
    assert_eq!(released.fee_amount, 0);

    let rel_event = BountyReleasedEvent::from_val(&env, &payout_events[2].1);
    assert_eq!(rel_event.amount, escrow_amount);
    assert_eq!(rel_event.fee_amount, 0);
    assert_eq!(rel_event.protocol_fee_bps, 0);
    assert_eq!(rel_event.released_at, 20_123);

    let token = TokenClient::new(&env, &fx.token_id);
    assert_eq!(token.balance(&fx.client.address), 0);
    assert_eq!(token.balance(&fx.contributor), escrow_amount);
    assert_eq!(token.balance(&fx.fee_recipient), 0);
}

#[test]
fn duplicate_or_rejected_payout_emits_no_events() {
    let env = Env::default();
    let fx = setup(&env);
    let id = create_and_submit(&env, &fx, 1_000, 100);

    // Rejected payout (wrong maintainer) emits zero events.
    let stranger = Address::generate(&env);
    let before_rejected = contract_event_count(&env, &fx.client.address);
    let err = fx.client.try_release_bounty(&id, &stranger);
    assert_eq!(
        err,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            ContractError::MaintainerMismatch as u32
        )))
    );
    assert_eq!(
        contract_events_since(&env, &fx.client.address, before_rejected).len(),
        0
    );

    // First valid payout commits once (3 events).
    let before_commit = contract_event_count(&env, &fx.client.address);
    fx.client.release_bounty(&id, &fx.maintainer);
    assert_eq!(
        contract_events_since(&env, &fx.client.address, before_commit).len(),
        3
    );

    // Duplicate payout fails and emits zero additional events.
    let before_dup = contract_event_count(&env, &fx.client.address);
    let dup_err = fx.client.try_release_bounty(&id, &fx.maintainer);
    assert_eq!(
        dup_err,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            ContractError::BountyMustBeSubmitted as u32
        )))
    );
    assert_eq!(
        contract_events_since(&env, &fx.client.address, before_dup).len(),
        0
    );
}
