//! Integration tests for contract payout boundaries (`release_bounty`):
//! - Exercise a submitted bounty after review eligibility begins with exact
//!   ledger timestamps and exact non-round token units.
//! - Confirm a defined result preserves one payout of the exact escrow amount
//!   (both zero-fee and fee-bearing, conserving `net_payout + fee_amount == amount`).
//! - Verify repeat release attempts are rejected (`BountyMustBeSubmitted` #20)
//!   without moving additional tokens or double-counting `FeeStats`.
//! - Verify unauthorized callers (`MaintainerMismatch` #25) and pre-submission
//!   states (`BountyMustBeSubmitted` #20) preserve escrow and bounty state.
//! - Verify concurrent bounties remain isolated during payout.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Error, FromVal, String,
};
use stellar_bounty_board::{
    BountyReleased, BountyReleasedEvent, BountyStatus, ContractError, StellarBountyBoardContract,
    StellarBountyBoardContractClient,
};

const DISPUTE_WINDOW: u64 = 600;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    fee_recipient: Address,
    arbiter: Address,
    maintainer: Address,
    contributor: Address,
    outsider: Address,
    token: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let outsider = Address::generate(&env);

    client.initialize(&admin, &fee_recipient, &arbiter, &DISPUTE_WINDOW);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    Fixture {
        env,
        client,
        fee_recipient,
        arbiter,
        maintainer,
        contributor,
        outsider,
        token,
    }
}

#[test]
fn release_submitted_bounty_at_review_eligibility_start_pays_exact_escrow_once() {
    let fix = setup();
    let token_client = TokenClient::new(&fix.env, &fix.token);
    let sac = StellarAssetClient::new(&fix.env, &fix.token);

    // Exact non-round token amount (1_234_567 units) with 0 bps fee
    let exact_amount: i128 = 1_234_567;
    sac.mint(&fix.maintainer, &exact_amount);

    let created_at: u64 = 20_000;
    let submitted_at: u64 = 20_500;
    let deadline: u64 = 21_500;
    fix.env.ledger().set_timestamp(created_at);

    let bounty_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &exact_amount,
        &String::from_str(&fix.env, "ritik4ever/stellar-bounty-board"),
        &2101,
        &String::from_str(&fix.env, "Exact payout at review eligibility start"),
        &deadline,
        &0u32,
        &None,
    );

    fix.client.reserve_bounty(&bounty_id, &fix.contributor);

    // Submit at exact ledger timestamp; review eligibility begins immediately
    fix.env.ledger().set_timestamp(submitted_at);
    fix.client.submit_bounty(&bounty_id, &fix.contributor);

    assert_eq!(token_client.balance(&fix.client.address), exact_amount);
    assert_eq!(token_client.balance(&fix.contributor), 0);
    assert_eq!(token_client.balance(&fix.fee_recipient), 0);

    // Release immediately at review eligibility start (now == submitted_at)
    fix.client.release_bounty(&bounty_id, &fix.maintainer);

    // Capture events emitted by `release_bounty` before any subsequent contract calls
    let events = fix.env.events().all().filter_by_contract(&fix.client.address);

    // Exact single payout: full escrow moves to contributor, escrow drops to 0
    assert_eq!(token_client.balance(&fix.client.address), 0);
    assert_eq!(token_client.balance(&fix.contributor), exact_amount);
    assert_eq!(token_client.balance(&fix.fee_recipient), 0);
    assert_eq!(token_client.balance(&fix.maintainer), 0);

    let bounty = fix.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);
    assert_eq!(bounty.amount, exact_amount);

    let stats = fix.client.get_fee_stats();
    assert_eq!(stats.total_collected, 0);
    assert_eq!(stats.bounty_count, 1);

    // Verify BountyReleased and BountyReleasedEvent payloads
    let len = events.events().len();
    assert!(len >= 2);

    let rel_event = &events.events()[len - 2];
    let soroban_sdk::xdr::ContractEventBody::V0(rel_body) = &rel_event.body;
    assert_eq!(
        soroban_sdk::Symbol::from_val(&fix.env, &rel_body.topics[0]),
        symbol_short!("Bounty")
    );
    assert_eq!(
        soroban_sdk::Symbol::from_val(&fix.env, &rel_body.topics[1]),
        symbol_short!("Releas")
    );
    assert_eq!(
        BountyReleased::from_val(&fix.env, &rel_body.data),
        BountyReleased {
            bounty_id,
            contributor: fix.contributor.clone(),
            amount: exact_amount,
            fee_amount: 0,
        }
    );

    let structured_event = &events.events()[len - 1];
    let soroban_sdk::xdr::ContractEventBody::V0(struct_body) = &structured_event.body;
    assert_eq!(
        soroban_sdk::Symbol::from_val(&fix.env, &struct_body.topics[0]),
        symbol_short!("Bounty")
    );
    assert_eq!(
        soroban_sdk::Symbol::from_val(&fix.env, &struct_body.topics[1]),
        symbol_short!("RelEvent")
    );
    assert_eq!(
        BountyReleasedEvent::from_val(&fix.env, &struct_body.data),
        BountyReleasedEvent {
            bounty_id,
            maintainer: fix.maintainer.clone(),
            contributor: fix.contributor.clone(),
            token: fix.token.clone(),
            amount: exact_amount,
            fee_amount: 0,
            protocol_fee_bps: 0,
            released_at: submitted_at,
        }
    );

    // Repeat release must fail and preserve the single payout
    let second = fix.client.try_release_bounty(&bounty_id, &fix.maintainer);
    let err = second
        .err()
        .expect("double release unexpectedly succeeded")
        .expect("expected typed contract error");
    assert_eq!(
        err,
        Error::from_contract_error(ContractError::BountyMustBeSubmitted as u32)
    );
    assert_eq!(token_client.balance(&fix.contributor), exact_amount);
    assert_eq!(token_client.balance(&fix.client.address), 0);
    assert_eq!(fix.client.get_fee_stats().bounty_count, 1);
}

#[test]
fn release_submitted_bounty_after_deadline_with_fee_conserves_exact_escrow_units() {
    let fix = setup();
    let token_client = TokenClient::new(&fix.env, &fix.token);
    let sac = StellarAssetClient::new(&fix.env, &fix.token);

    // Non-round amount and non-round fee bps (2.75% = 275 bps)
    let exact_amount: i128 = 1_234_567;
    let fee_bps: u32 = 275;
    let expected_fee: i128 = (exact_amount * fee_bps as i128) / 10_000; // 33_950
    let expected_net: i128 = exact_amount - expected_fee; // 1_200_617
    assert_eq!(expected_fee, 33_950);
    assert_eq!(expected_net, 1_200_617);
    assert_eq!(expected_net + expected_fee, exact_amount);

    sac.mint(&fix.maintainer, &exact_amount);

    let created_at: u64 = 30_000;
    let deadline: u64 = 31_000;
    let release_at: u64 = deadline + 1_500; // 32_500 (strictly after deadline)
    fix.env.ledger().set_timestamp(created_at);

    let bounty_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &exact_amount,
        &String::from_str(&fix.env, "ritik4ever/stellar-bounty-board"),
        &2102,
        &String::from_str(&fix.env, "Post-deadline fee-bearing exact payout"),
        &deadline,
        &fee_bps,
        &None,
    );

    fix.client.reserve_bounty(&bounty_id, &fix.contributor);
    fix.env.ledger().set_timestamp(deadline);
    fix.client.submit_bounty(&bounty_id, &fix.contributor);

    // Advance ledger past deadline; submitted bounty remains eligible for maintainer review/payout
    fix.env.ledger().set_timestamp(release_at);
    fix.client.release_bounty(&bounty_id, &fix.maintainer);

    assert_eq!(token_client.balance(&fix.contributor), expected_net);
    assert_eq!(token_client.balance(&fix.fee_recipient), expected_fee);
    assert_eq!(token_client.balance(&fix.client.address), 0);
    assert_eq!(
        fix.client.get_bounty(&bounty_id).status,
        BountyStatus::Released
    );

    let stats = fix.client.get_fee_stats();
    assert_eq!(stats.total_collected, expected_fee);
    assert_eq!(stats.bounty_count, 1);
}

#[test]
fn release_bounty_rejects_unauthorized_callers_and_pre_submission_states() {
    let fix = setup();
    let token_client = TokenClient::new(&fix.env, &fix.token);
    let sac = StellarAssetClient::new(&fix.env, &fix.token);

    let exact_amount: i128 = 777_889;
    sac.mint(&fix.maintainer, &exact_amount);

    fix.env.ledger().set_timestamp(40_000);
    let deadline: u64 = 41_000;

    let bounty_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &exact_amount,
        &String::from_str(&fix.env, "ritik4ever/stellar-bounty-board"),
        &2103,
        &String::from_str(&fix.env, "Auth and state boundaries before payout"),
        &deadline,
        &150u32,
        &None,
    );

    // 1. Open bounty cannot be released before review eligibility begins
    let open_err = fix
        .client
        .try_release_bounty(&bounty_id, &fix.maintainer)
        .err()
        .expect("Open release should fail")
        .expect("expected typed contract error");
    assert_eq!(
        open_err,
        Error::from_contract_error(ContractError::BountyMustBeSubmitted as u32)
    );

    // 2. Reserved bounty cannot be released before submission
    fix.client.reserve_bounty(&bounty_id, &fix.contributor);
    let reserved_err = fix
        .client
        .try_release_bounty(&bounty_id, &fix.maintainer)
        .err()
        .expect("Reserved release should fail")
        .expect("expected typed contract error");
    assert_eq!(
        reserved_err,
        Error::from_contract_error(ContractError::BountyMustBeSubmitted as u32)
    );

    // 3. Submit bounty, then reject non-maintainer callers
    fix.env.ledger().set_timestamp(40_500);
    fix.client.submit_bounty(&bounty_id, &fix.contributor);

    for caller in [&fix.contributor, &fix.arbiter, &fix.outsider] {
        let auth_err = fix
            .client
            .try_release_bounty(&bounty_id, caller)
            .err()
            .expect("non-maintainer release should fail")
            .expect("expected typed contract error");
        assert_eq!(
            auth_err,
            Error::from_contract_error(ContractError::MaintainerMismatch as u32)
        );
    }

    // Escrow, status, and FeeStats remain untouched after all rejected attempts
    assert_eq!(token_client.balance(&fix.client.address), exact_amount);
    assert_eq!(token_client.balance(&fix.contributor), 0);
    assert_eq!(token_client.balance(&fix.fee_recipient), 0);
    assert_eq!(
        fix.client.get_bounty(&bounty_id).status,
        BountyStatus::Submitted
    );
    assert_eq!(fix.client.get_fee_stats().bounty_count, 0);

    // 4. Legitimate maintainer can still release the exact escrow once
    fix.client.release_bounty(&bounty_id, &fix.maintainer);
    let expected_fee = (exact_amount * 150) / 10_000;
    assert_eq!(
        token_client.balance(&fix.contributor),
        exact_amount - expected_fee
    );
    assert_eq!(token_client.balance(&fix.fee_recipient), expected_fee);
    assert_eq!(token_client.balance(&fix.client.address), 0);
}

#[test]
fn release_bounty_isolates_concurrent_bounty_escrow() {
    let fix = setup();
    let token_client = TokenClient::new(&fix.env, &fix.token);
    let sac = StellarAssetClient::new(&fix.env, &fix.token);

    let amount_a: i128 = 333_333;
    let amount_b: i128 = 666_667;
    sac.mint(&fix.maintainer, &(amount_a + amount_b));

    fix.env.ledger().set_timestamp(50_000);
    let deadline: u64 = 52_000;

    let bounty_a = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &amount_a,
        &String::from_str(&fix.env, "ritik4ever/stellar-bounty-board"),
        &2104,
        &String::from_str(&fix.env, "Concurrent bounty A"),
        &deadline,
        &0u32,
        &None,
    );
    let bounty_b = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &amount_b,
        &String::from_str(&fix.env, "ritik4ever/stellar-bounty-board"),
        &2105,
        &String::from_str(&fix.env, "Concurrent bounty B"),
        &deadline,
        &0u32,
        &None,
    );

    fix.client.reserve_bounty(&bounty_a, &fix.contributor);
    fix.client.submit_bounty(&bounty_a, &fix.contributor);
    fix.client.reserve_bounty(&bounty_b, &fix.contributor);
    fix.client.submit_bounty(&bounty_b, &fix.contributor);

    assert_eq!(
        token_client.balance(&fix.client.address),
        amount_a + amount_b
    );

    // Release only bounty A
    fix.client.release_bounty(&bounty_a, &fix.maintainer);

    assert_eq!(token_client.balance(&fix.contributor), amount_a);
    assert_eq!(token_client.balance(&fix.client.address), amount_b);
    assert_eq!(
        fix.client.get_bounty(&bounty_a).status,
        BountyStatus::Released
    );
    assert_eq!(
        fix.client.get_bounty(&bounty_b).status,
        BountyStatus::Submitted
    );
}
