//! Integration tests for Contract submission boundaries (SBB-2026-416, #1885):
//! - Exercise a reserved bounty submitted at the exact deadline boundary (`ledger.timestamp() == deadline`)
//!   with exact non-round token units and exact ledger timestamps.
//! - Verify that authorized submission preserves status `Submitted`, assigns contributor, emits
//!   `BountySubmitted`, and leaves escrow balances invariant (zero tokens moved).
//! - Verify that submissions attempted strictly after the deadline (`now > deadline`) fail with `BountyExpired` (#22)
//!   while strictly preserving escrow balances.
//! - Verify that unauthorized and mismatched callers at the deadline boundary fail with `ContributorMismatch` (#26)
//!   without moving funds or mutating state.
//! - Verify that once submitted at or before deadline, subsequent timestamp advances past deadline do not expire
//!   the bounty.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Error, FromVal, String,
};
use stellar_bounty_board::{
    BountyStatus, BountySubmitted, ContractError, StellarBountyBoardContract,
    StellarBountyBoardContractClient,
};

const DISPUTE_WINDOW: u64 = 600;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
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
        maintainer,
        contributor,
        outsider,
        token,
    }
}

#[test]
fn submit_bounty_at_exact_deadline_boundary_succeeds_and_preserves_escrow_balance() {
    let fix = setup();
    let token_client = TokenClient::new(&fix.env, &fix.token);
    let sac = StellarAssetClient::new(&fix.env, &fix.token);

    // Exact non-round token amount (1_234_567 units)
    let exact_amount: i128 = 1_234_567;
    sac.mint(&fix.maintainer, &exact_amount);

    let initial_timestamp: u64 = 20_000;
    fix.env.ledger().set_timestamp(initial_timestamp);
    let deadline: u64 = initial_timestamp + 1_500; // 21_500

    let bounty_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &exact_amount,
        &String::from_str(&fix.env, "ritik4ever/stellar-bounty-board"),
        &1885,
        &String::from_str(&fix.env, "Submit at exact deadline boundary"),
        &deadline,
        &300u32,
        &None,
    );

    fix.client.reserve_bounty(&bounty_id, &fix.contributor);

    // Verify initial balances before submission: escrow holds exact amount, contributor & maintainer hold 0
    assert_eq!(token_client.balance(&fix.client.address), exact_amount);
    assert_eq!(token_client.balance(&fix.contributor), 0);
    assert_eq!(token_client.balance(&fix.maintainer), 0);
    assert_eq!(
        fix.client.get_bounty(&bounty_id).status,
        BountyStatus::Reserved
    );

    // Advance timestamp to EXACT deadline: now == deadline
    fix.env.ledger().set_timestamp(deadline);

    // Submission at now == deadline is authorized and allowed
    fix.client.submit_bounty(&bounty_id, &fix.contributor);

    // Event verification: BountySubmitted emitted with correct payload
    let events = fix.env.events().all().filter_by_contract(&fix.client.address);
    let last_event = events.events().last().unwrap();
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &last_event.body;
    let t0 = soroban_sdk::Symbol::from_val(&fix.env, &body.topics[0]);
    let t1 = soroban_sdk::Symbol::from_val(&fix.env, &body.topics[1]);
    assert_eq!(t0, symbol_short!("Bounty"));
    assert_eq!(t1, symbol_short!("Submit"));
    let payload = BountySubmitted::from_val(&fix.env, &body.data);
    assert_eq!(
        payload,
        BountySubmitted {
            bounty_id,
            contributor: fix.contributor.clone(),
        }
    );

    // State assertion: transitions to Submitted
    let bounty = fix.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Submitted);
    assert_eq!(bounty.contributor, Some(fix.contributor.clone()));

    // Escrow balance invariant: 0 tokens transferred, balance completely unchanged
    assert_eq!(token_client.balance(&fix.client.address), exact_amount);
    assert_eq!(token_client.balance(&fix.contributor), 0);
    assert_eq!(token_client.balance(&fix.maintainer), 0);
}

#[test]
fn submit_bounty_one_second_past_deadline_rejected_with_bounty_expired_and_preserves_escrow_balance() {
    let fix = setup();
    let token_client = TokenClient::new(&fix.env, &fix.token);
    let sac = StellarAssetClient::new(&fix.env, &fix.token);

    let exact_amount: i128 = 987_654;
    sac.mint(&fix.maintainer, &exact_amount);

    let initial_timestamp: u64 = 30_000;
    fix.env.ledger().set_timestamp(initial_timestamp);
    let deadline: u64 = initial_timestamp + 800; // 30_800

    let bounty_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &exact_amount,
        &String::from_str(&fix.env, "ritik4ever/stellar-bounty-board"),
        &1886,
        &String::from_str(&fix.env, "Submit strictly past deadline"),
        &deadline,
        &0u32,
        &None,
    );

    fix.client.reserve_bounty(&bounty_id, &fix.contributor);

    // Verify initial escrow state
    assert_eq!(token_client.balance(&fix.client.address), exact_amount);
    assert_eq!(token_client.balance(&fix.contributor), 0);

    // Advance timestamp strictly past deadline: now == deadline + 1 (30_801)
    fix.env.ledger().set_timestamp(deadline + 1);

    // Attempting submit_bounty strictly after deadline must fail with BountyExpired (#22)
    let res = fix.client.try_submit_bounty(&bounty_id, &fix.contributor);
    let err = res
        .err()
        .expect("submission past deadline unexpectedly succeeded")
        .expect("expected typed contract error");
    assert_eq!(
        err,
        Error::from_contract_error(ContractError::BountyExpired as u32)
    );

    // Escrow balance invariant: 0 tokens moved, balance preserved
    assert_eq!(token_client.balance(&fix.client.address), exact_amount);
    assert_eq!(token_client.balance(&fix.contributor), 0);
    assert_eq!(token_client.balance(&fix.maintainer), 0);
}

#[test]
fn submit_bounty_at_deadline_rejects_unauthorized_and_mismatched_callers() {
    let fix = setup();
    let token_client = TokenClient::new(&fix.env, &fix.token);
    let sac = StellarAssetClient::new(&fix.env, &fix.token);

    let exact_amount: i128 = 555_777;
    sac.mint(&fix.maintainer, &exact_amount);

    let initial_timestamp: u64 = 40_000;
    fix.env.ledger().set_timestamp(initial_timestamp);
    let deadline: u64 = initial_timestamp + 1_000;

    let bounty_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &exact_amount,
        &String::from_str(&fix.env, "ritik4ever/stellar-bounty-board"),
        &1887,
        &String::from_str(&fix.env, "Mismatched submit at deadline"),
        &deadline,
        &100u32,
        &None,
    );

    fix.client.reserve_bounty(&bounty_id, &fix.contributor);

    // Advance to exact deadline
    fix.env.ledger().set_timestamp(deadline);

    let event_count_before = fix
        .env
        .events()
        .all()
        .filter_by_contract(&fix.client.address)
        .events()
        .len();

    // 1. Outsider caller attempting submit_bounty is rejected with ContributorMismatch (#26)
    let res_outsider = fix.client.try_submit_bounty(&bounty_id, &fix.outsider);
    let err_outsider = res_outsider
        .err()
        .expect("outsider submit should fail")
        .expect("expected typed contract error");
    assert_eq!(
        err_outsider,
        Error::from_contract_error(ContractError::ContributorMismatch as u32)
    );

    // 2. Maintainer attempting submit_bounty is also rejected with ContributorMismatch (#26)
    let res_maintainer = fix.client.try_submit_bounty(&bounty_id, &fix.maintainer);
    let err_maintainer = res_maintainer
        .err()
        .expect("maintainer submit should fail")
        .expect("expected typed contract error");
    assert_eq!(
        err_maintainer,
        Error::from_contract_error(ContractError::ContributorMismatch as u32)
    );

    // Neither failed call may mutate the reservation, emit a submit event, or move tokens.
    let bounty = fix.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);
    assert_eq!(bounty.contributor, Some(fix.contributor.clone()));
    assert_eq!(
        fix.env
            .events()
            .all()
            .filter_by_contract(&fix.client.address)
            .events()
            .len(),
        event_count_before
    );
    assert_eq!(token_client.balance(&fix.client.address), exact_amount);
    assert_eq!(token_client.balance(&fix.contributor), 0);
    assert_eq!(token_client.balance(&fix.maintainer), 0);

    // The failed attempts leave the legitimate contributor able to submit once.
    fix.client.submit_bounty(&bounty_id, &fix.contributor);
    assert_eq!(
        fix.client.get_bounty(&bounty_id).status,
        BountyStatus::Submitted
    );
    assert_eq!(
        fix.env
            .events()
            .all()
            .filter_by_contract(&fix.client.address)
            .events()
            .len(),
        event_count_before + 1
    );
    assert_eq!(token_client.balance(&fix.client.address), exact_amount);
    assert_eq!(token_client.balance(&fix.contributor), 0);
    assert_eq!(token_client.balance(&fix.maintainer), 0);
}

#[test]
fn submitted_bounty_immune_to_expiration_when_ledger_advances_past_deadline() {
    let fix = setup();
    let sac = StellarAssetClient::new(&fix.env, &fix.token);

    let exact_amount: i128 = 2_345_678;
    sac.mint(&fix.maintainer, &exact_amount);

    let initial_timestamp: u64 = 50_000;
    fix.env.ledger().set_timestamp(initial_timestamp);
    let deadline: u64 = initial_timestamp + 600; // 50_600

    let bounty_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &exact_amount,
        &String::from_str(&fix.env, "ritik4ever/stellar-bounty-board"),
        &1888,
        &String::from_str(&fix.env, "Post-submission time immunity"),
        &deadline,
        &200u32,
        &None,
    );

    fix.client.reserve_bounty(&bounty_id, &fix.contributor);

    // Submit at exact deadline
    fix.env.ledger().set_timestamp(deadline);
    fix.client.submit_bounty(&bounty_id, &fix.contributor);
    assert_eq!(
        fix.client.get_bounty(&bounty_id).status,
        BountyStatus::Submitted
    );

    // Advance timestamp far into the future (10,000 seconds past deadline)
    fix.env.ledger().set_timestamp(deadline + 10_000);

    // The bounty must remain in Submitted status, NOT Expired
    let bounty = fix.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Submitted);
    assert_eq!(bounty.contributor, Some(fix.contributor.clone()));
}

#[test]
fn submit_bounty_non_reserved_states_rejected_at_deadline_boundary() {
    let fix = setup();
    let sac = StellarAssetClient::new(&fix.env, &fix.token);

    let exact_amount: i128 = 1_000_000;
    sac.mint(&fix.maintainer, &exact_amount);

    let initial_timestamp: u64 = 60_000;
    fix.env.ledger().set_timestamp(initial_timestamp);
    let deadline: u64 = initial_timestamp + 500;

    // Create bounty but do NOT reserve it (Open status)
    let bounty_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &exact_amount,
        &String::from_str(&fix.env, "ritik4ever/stellar-bounty-board"),
        &1889,
        &String::from_str(&fix.env, "Submit on Open status"),
        &deadline,
        &0u32,
        &None,
    );

    // Advance to deadline
    fix.env.ledger().set_timestamp(deadline);

    // Attempting submit_bounty on an Open bounty must fail with BountyMustBeReserved (#19)
    let res = fix.client.try_submit_bounty(&bounty_id, &fix.contributor);
    let err = res
        .err()
        .expect("Open submit should fail")
        .expect("expected typed contract error");
    assert_eq!(
        err,
        Error::from_contract_error(ContractError::BountyMustBeReserved as u32)
    );
}
