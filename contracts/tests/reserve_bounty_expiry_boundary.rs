//! Focused boundary tests for `reserve_bounty` at the exact expiry ledger.
//!
//! Verifies that:
//! - Reservation at `now == bounty.deadline` succeeds, assigns exactly one
//!   contributor, and preserves the exact locked escrow balance without moving
//!   tokens.
//! - Competing or duplicate reservations at `now == bounty.deadline` fail with
//!   `ContractError::BountyAlreadyReserved`, preserving the single contributor
//!   and locked escrow.
//! - Reservation at `now == bounty.deadline + 1` fails with
//!   `ContractError::BountyExpired`, leaving `contributor == None` and the
//!   exact escrow balance locked in the contract.
//! - A bounty reserved at `now == bounty.deadline` retains its single
//!   contributor and locked escrow after `now > bounty.deadline`.

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Error, String,
};
use stellar_bounty_board::{
    BountyStatus, ContractError, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

fn contract_err(err: ContractError) -> Error {
    Error::from_contract_error(err as u32)
}

struct TestFixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    token_id: Address,
    maintainer: Address,
    contributor_a: Address,
    contributor_b: Address,
}

fn setup(initial_timestamp: u64, mint_amount: i128) -> TestFixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(initial_timestamp);

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor_a = Address::generate(&env);
    let contributor_b = Address::generate(&env);

    client.initialize(&admin, &fee_recipient, &arbiter, &600);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_id = token_contract.address();
    let asset_client = StellarAssetClient::new(&env, &token_id);
    asset_client.mint(&maintainer, &mint_amount);

    TestFixture {
        env,
        client,
        token_id,
        maintainer,
        contributor_a,
        contributor_b,
    }
}

#[test]
fn reserve_bounty_at_exact_expiry_ledger_succeeds_and_preserves_one_contributor_and_escrow() {
    let start_ts: u64 = 1_700_000_000;
    let deadline: u64 = start_ts + 1_000;
    let mint_amount: i128 = 500_000_000;
    let escrow_amount: i128 = 123_456_789;

    let f = setup(start_ts, mint_amount);
    let token = TokenClient::new(&f.env, &f.token_id);

    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.token_id,
        &escrow_amount,
        &String::from_str(&f.env, "owner/repo"),
        &42,
        &String::from_str(&f.env, "Exact expiry reservation"),
        &deadline,
        &250u32,
        &None,
    );

    assert_eq!(token.balance(&f.client.address), escrow_amount);
    assert_eq!(token.balance(&f.maintainer), mint_amount - escrow_amount);
    assert_eq!(token.balance(&f.contributor_a), 0);
    assert_eq!(token.balance(&f.contributor_b), 0);

    // Move to the exact expiry ledger timestamp (now == deadline).
    f.env.ledger().set_timestamp(deadline);

    // First contributor reserves at the exact expiry ledger: succeeds because
    // expiration triggers strictly after the deadline (`now > bounty.deadline`).
    f.client.reserve_bounty(&bounty_id, &f.contributor_a);

    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);
    assert_eq!(bounty.contributor, Some(f.contributor_a.clone()));
    assert_eq!(bounty.amount, escrow_amount);
    assert_eq!(bounty.deadline, deadline);

    // Escrow stays locked in the contract with exact token units.
    assert_eq!(token.balance(&f.client.address), escrow_amount);
    assert_eq!(token.balance(&f.maintainer), mint_amount - escrow_amount);
    assert_eq!(token.balance(&f.contributor_a), 0);
    assert_eq!(token.balance(&f.contributor_b), 0);

    // A competing contributor at the same exact expiry ledger is rejected.
    let competing = f
        .client
        .try_reserve_bounty(&bounty_id, &f.contributor_b);
    assert_eq!(competing, Err(Ok(contract_err(ContractError::BountyAlreadyReserved))));

    // Re-reserving by the same contributor is also rejected.
    let duplicate = f
        .client
        .try_reserve_bounty(&bounty_id, &f.contributor_a);
    assert_eq!(duplicate, Err(Ok(contract_err(ContractError::BountyAlreadyReserved))));

    // Single contributor and locked escrow remain intact.
    let bounty_after = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty_after.status, BountyStatus::Reserved);
    assert_eq!(bounty_after.contributor, Some(f.contributor_a.clone()));
    assert_eq!(token.balance(&f.client.address), escrow_amount);
    assert_eq!(token.balance(&f.maintainer), mint_amount - escrow_amount);
    assert_eq!(token.balance(&f.contributor_a), 0);
    assert_eq!(token.balance(&f.contributor_b), 0);
}

#[test]
fn reserve_bounty_one_second_after_expiry_ledger_fails_and_preserves_locked_escrow() {
    let start_ts: u64 = 1_700_000_000;
    let deadline: u64 = start_ts + 1_000;
    let mint_amount: i128 = 1_000_000_000;
    let escrow_amount: i128 = 777_000_001;

    let f = setup(start_ts, mint_amount);
    let token = TokenClient::new(&f.env, &f.token_id);

    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.token_id,
        &escrow_amount,
        &String::from_str(&f.env, "owner/repo"),
        &43,
        &String::from_str(&f.env, "One second past expiry"),
        &deadline,
        &0u32,
        &None,
    );

    // Advance one ledger second past the expiry boundary (now == deadline + 1).
    f.env.ledger().set_timestamp(deadline + 1);

    let result = f
        .client
        .try_reserve_bounty(&bounty_id, &f.contributor_a);
    assert_eq!(result, Err(Ok(contract_err(ContractError::BountyExpired))));

    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Expired);
    assert_eq!(bounty.contributor, None);
    assert_eq!(token.balance(&f.client.address), escrow_amount);
    assert_eq!(token.balance(&f.maintainer), mint_amount - escrow_amount);
    assert_eq!(token.balance(&f.contributor_a), 0);
}

#[test]
fn reservation_at_exact_expiry_preserves_contributor_and_locked_escrow_after_deadline() {
    let start_ts: u64 = 1_700_000_000;
    let deadline: u64 = start_ts + 500;
    let mint_amount: i128 = 250_000_000;
    let escrow_amount: i128 = 100_000_007;

    let f = setup(start_ts, mint_amount);
    let token = TokenClient::new(&f.env, &f.token_id);

    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.token_id,
        &escrow_amount,
        &String::from_str(&f.env, "owner/repo"),
        &44,
        &String::from_str(&f.env, "Post-expiry invariants"),
        &deadline,
        &100u32,
        &None,
    );

    // Reserve at the exact expiry ledger.
    f.env.ledger().set_timestamp(deadline);
    f.client.reserve_bounty(&bounty_id, &f.contributor_a);

    // Advance past the expiry ledger.
    f.env.ledger().set_timestamp(deadline + 1);

    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Expired);
    assert_eq!(bounty.contributor, Some(f.contributor_a.clone()));

    // Another contributor cannot take over the expired reservation.
    let late_reserve = f
        .client
        .try_reserve_bounty(&bounty_id, &f.contributor_b);
    assert_eq!(late_reserve, Err(Ok(contract_err(ContractError::BountyExpired))));

    // Maintainer cannot reclaim via refund_bounty once a contributor was assigned.
    let late_refund = f.client.try_refund_bounty(&bounty_id, &f.maintainer);
    assert_eq!(
        late_refund,
        Err(Ok(contract_err(ContractError::BountyAlreadyFinalized)))
    );

    // Exact escrow remains locked and contributor assignment is preserved.
    let bounty_final = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty_final.contributor, Some(f.contributor_a.clone()));
    assert_eq!(token.balance(&f.client.address), escrow_amount);
    assert_eq!(token.balance(&f.maintainer), mint_amount - escrow_amount);
    assert_eq!(token.balance(&f.contributor_a), 0);
    assert_eq!(token.balance(&f.contributor_b), 0);
}
