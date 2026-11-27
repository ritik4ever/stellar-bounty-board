//! Focused atomicity tests for contract reservation (`reserve_bounty`, SBB-2026-412).
//!
//! Verifies that failed reservation calls — including a second contributor racing to
//! reserve around storage and token calls — revert atomically with:
//! - zero storage mutations (original status and contributor preserved),
//! - zero emitted contract events,
//! - zero token transfers, and
//! - exact escrow conservation (funds can neither be stranded nor multiplied).

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Error, String,
};
use stellar_bounty_board::{
    BountyStatus, ContractError, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

fn contract_err(err: ContractError) -> Error {
    Error::from_contract_error(err as u32)
}

#[contract]
struct CountingToken;

#[contractimpl]
impl CountingToken {
    pub fn transfer(env: Env, _from: Address, _to: Address, _amount: i128) {
        let key = symbol_short!("XFER_CNT");
        let count = env.storage().instance().get::<_, u32>(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(count + 1));
    }

    pub fn transfer_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&symbol_short!("XFER_CNT"))
            .unwrap_or(0)
    }
}

struct SacFixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    maintainer: Address,
    contributor_1: Address,
    contributor_2: Address,
    fee_recipient: Address,
    token: Address,
}

fn setup_sac_fixture() -> SacFixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor_1 = Address::generate(&env);
    let contributor_2 = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let arbiter = Address::generate(&env);

    client.initialize(&admin, &fee_recipient, &arbiter, &600);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    SacFixture {
        env,
        client,
        maintainer,
        contributor_1,
        contributor_2,
        fee_recipient,
        token,
    }
}

fn fund_bounty(f: &SacFixture, amount: i128, issue_num: u32, deadline: u64, fee_bps: u32) -> u64 {
    StellarAssetClient::new(&f.env, &f.token).mint(&f.maintainer, &amount);
    f.client.create_bounty(
        &f.maintainer,
        &f.token,
        &amount,
        &String::from_str(&f.env, "ritik4ever/stellar-bounty-board"),
        &issue_num,
        &String::from_str(&f.env, "Atomic reservation test"),
        &deadline,
        &fee_bps,
        &None,
    )
}

#[test]
fn racing_second_contributor_reserve_failure_is_atomic_and_preserves_escrow() {
    let f = setup_sac_fixture();
    let amount: i128 = 1_000_000;
    let fee_bps: u32 = 250; // 2.5%
    let deadline = f.env.ledger().timestamp() + 1_000;
    let bounty_id = fund_bounty(&f, amount, 412, deadline, fee_bps);
    let token = TokenClient::new(&f.env, &f.token);

    assert_eq!(token.balance(&f.client.address), amount);

    // First contributor reserves the open bounty.
    f.client.reserve_bounty(&bounty_id, &f.contributor_1);
    let reserved = f.client.get_bounty(&bounty_id);
    assert_eq!(reserved.status, BountyStatus::Reserved);
    assert_eq!(reserved.contributor, Some(f.contributor_1.clone()));
    assert_eq!(token.balance(&f.client.address), amount);

    // Second contributor races to reserve the same bounty and fails atomically.
    let race_err = f
        .client
        .try_reserve_bounty(&bounty_id, &f.contributor_2)
        .expect_err("racing second contributor must fail");
    assert_eq!(race_err, Ok(contract_err(ContractError::BountyAlreadyReserved)));

    // Failed call must emit zero events and leave storage & escrow untouched.
    assert_eq!(
        f.env
            .events()
            .all()
            .filter_by_contract(&f.client.address)
            .events()
            .len(),
        0,
        "failed reserve_bounty must not emit events"
    );
    let after_race = f.client.get_bounty(&bounty_id);
    assert_eq!(after_race.status, BountyStatus::Reserved);
    assert_eq!(after_race.contributor, Some(f.contributor_1.clone()));
    assert_eq!(token.balance(&f.client.address), amount);
    assert_eq!(token.balance(&f.contributor_1), 0);
    assert_eq!(token.balance(&f.contributor_2), 0);

    // First contributor completes submission and receives exact net payout; escrow drains to 0.
    f.client.submit_bounty(&bounty_id, &f.contributor_1);
    f.client.release_bounty(&bounty_id, &f.maintainer);

    let expected_fee = (amount * fee_bps as i128) / 10_000;
    let expected_payout = amount - expected_fee;
    assert_eq!(token.balance(&f.contributor_1), expected_payout);
    assert_eq!(token.balance(&f.fee_recipient), expected_fee);
    assert_eq!(token.balance(&f.contributor_2), 0);
    assert_eq!(token.balance(&f.client.address), 0);
}

#[test]
fn racing_reserve_around_submit_release_and_refund_cannot_strand_or_multiply_escrow() {
    let f = setup_sac_fixture();
    let amount_a: i128 = 500_000;
    let amount_b: i128 = 750_000;
    let deadline = f.env.ledger().timestamp() + 1_000;
    let bounty_a = fund_bounty(&f, amount_a, 1, deadline, 0);
    let bounty_b = fund_bounty(&f, amount_b, 2, deadline, 0);
    let token = TokenClient::new(&f.env, &f.token);

    assert_eq!(token.balance(&f.client.address), amount_a + amount_b);

    // Reserve and submit bounty A.
    f.client.reserve_bounty(&bounty_a, &f.contributor_1);
    f.client.submit_bounty(&bounty_a, &f.contributor_1);

    // Racing contributor attempts to reserve while Submitted -> fails atomically.
    let err_submitted = f
        .client
        .try_reserve_bounty(&bounty_a, &f.contributor_2)
        .expect_err("reserving a Submitted bounty must fail");
    assert_eq!(err_submitted, Ok(contract_err(ContractError::BountyNotOpen)));
    assert_eq!(
        f.env
            .events()
            .all()
            .filter_by_contract(&f.client.address)
            .events()
            .len(),
        0
    );
    assert_eq!(f.client.get_bounty(&bounty_a).status, BountyStatus::Submitted);
    assert_eq!(token.balance(&f.client.address), amount_a + amount_b);

    // Release bounty A (token payout to contributor_1).
    f.client.release_bounty(&bounty_a, &f.maintainer);
    assert_eq!(token.balance(&f.contributor_1), amount_a);
    assert_eq!(token.balance(&f.client.address), amount_b);

    // Racing contributor attempts to reserve after Released -> fails atomically.
    let err_released = f
        .client
        .try_reserve_bounty(&bounty_a, &f.contributor_2)
        .expect_err("reserving a Released bounty must fail");
    assert_eq!(err_released, Ok(contract_err(ContractError::BountyNotOpen)));
    assert_eq!(
        f.env
            .events()
            .all()
            .filter_by_contract(&f.client.address)
            .events()
            .len(),
        0
    );
    assert_eq!(f.client.get_bounty(&bounty_a).status, BountyStatus::Released);
    assert_eq!(token.balance(&f.contributor_1), amount_a);
    assert_eq!(token.balance(&f.contributor_2), 0);
    assert_eq!(token.balance(&f.client.address), amount_b);

    // Advance past deadline and refund bounty B (token refund to maintainer).
    f.env.ledger().set_timestamp(deadline + 1);
    f.client.refund_bounty(&bounty_b, &f.maintainer);
    assert_eq!(token.balance(&f.maintainer), amount_b);
    assert_eq!(token.balance(&f.client.address), 0);

    // Racing contributor attempts to reserve after Refunded -> fails atomically.
    let err_refunded = f
        .client
        .try_reserve_bounty(&bounty_b, &f.contributor_2)
        .expect_err("reserving a Refunded bounty must fail");
    assert_eq!(err_refunded, Ok(contract_err(ContractError::BountyNotOpen)));
    assert_eq!(
        f.env
            .events()
            .all()
            .filter_by_contract(&f.client.address)
            .events()
            .len(),
        0
    );
    assert_eq!(f.client.get_bounty(&bounty_b).status, BountyStatus::Refunded);
    assert_eq!(token.balance(&f.maintainer), amount_b);
    assert_eq!(token.balance(&f.contributor_2), 0);
    assert_eq!(token.balance(&f.client.address), 0);
}

#[test]
fn failed_reserve_on_paused_expired_and_missing_bounty_leaves_escrow_recoverable() {
    let f = setup_sac_fixture();
    let amount_paused: i128 = 300_000;
    let amount_expired: i128 = 400_000;
    let deadline = f.env.ledger().timestamp() + 1_000;
    let bounty_paused = fund_bounty(&f, amount_paused, 10, deadline, 0);
    let bounty_expired = fund_bounty(&f, amount_expired, 11, deadline, 0);
    let token = TokenClient::new(&f.env, &f.token);

    // 1. Nonexistent bounty fails atomically without affecting existing escrow.
    let missing_err = f
        .client
        .try_reserve_bounty(&999_999, &f.contributor_2)
        .expect_err("reserving nonexistent bounty must fail");
    assert_eq!(missing_err, Ok(contract_err(ContractError::BountyNotFound)));
    assert_eq!(
        f.env
            .events()
            .all()
            .filter_by_contract(&f.client.address)
            .events()
            .len(),
        0
    );
    assert_eq!(
        token.balance(&f.client.address),
        amount_paused + amount_expired
    );

    // 2. Paused contract rejects reservation atomically; unpausing allows normal settlement.
    f.client.pause();
    let paused_err = f
        .client
        .try_reserve_bounty(&bounty_paused, &f.contributor_1)
        .expect_err("reserving while paused must fail");
    assert_eq!(paused_err, Ok(contract_err(ContractError::ContractIsPaused)));
    assert_eq!(
        f.env
            .events()
            .all()
            .filter_by_contract(&f.client.address)
            .events()
            .len(),
        0
    );
    let b_paused = f.client.get_bounty(&bounty_paused);
    assert_eq!(b_paused.status, BountyStatus::Open);
    assert_eq!(b_paused.contributor, None);

    f.client.unpause();
    f.client.reserve_bounty(&bounty_paused, &f.contributor_1);
    f.client.submit_bounty(&bounty_paused, &f.contributor_1);
    f.client.release_bounty(&bounty_paused, &f.maintainer);
    assert_eq!(token.balance(&f.contributor_1), amount_paused);
    assert_eq!(token.balance(&f.client.address), amount_expired);

    // 3. Past deadline, reservation fails atomically and maintainer can still refund full escrow.
    f.env.ledger().set_timestamp(deadline + 1);
    let expired_err = f
        .client
        .try_reserve_bounty(&bounty_expired, &f.contributor_2)
        .expect_err("reserving expired bounty must fail");
    assert_eq!(expired_err, Ok(contract_err(ContractError::BountyExpired)));
    assert_eq!(
        f.env
            .events()
            .all()
            .filter_by_contract(&f.client.address)
            .events()
            .len(),
        0
    );
    assert_eq!(token.balance(&f.client.address), amount_expired);

    f.client.refund_bounty(&bounty_expired, &f.maintainer);
    assert_eq!(token.balance(&f.maintainer), amount_expired);
    assert_eq!(token.balance(&f.client.address), 0);
}

#[test]
fn failed_reserve_race_invokes_zero_token_transfers_and_isolates_concurrent_bounties() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);
    let token_id = env.register(CountingToken, ());
    let token_client = CountingTokenClient::new(&env, &token_id);

    let admin = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor_1 = Address::generate(&env);
    let contributor_2 = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let arbiter = Address::generate(&env);
    client.initialize(&admin, &fee_recipient, &arbiter, &600);

    let deadline = env.ledger().timestamp() + 1_000;
    let bounty_1 = client.create_bounty(
        &maintainer,
        &token_id,
        &100_000,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "bounty 1"),
        &deadline,
        &0,
        &None,
    );
    let bounty_2 = client.create_bounty(
        &maintainer,
        &token_id,
        &200_000,
        &String::from_str(&env, "repo"),
        &2,
        &String::from_str(&env, "bounty 2"),
        &deadline,
        &0,
        &None,
    );

    // Exactly two funding transfers occurred during create_bounty.
    assert_eq!(token_client.transfer_count(), 2);

    // Successful reservation on bounty 1 invokes zero token transfers.
    client.reserve_bounty(&bounty_1, &contributor_1);
    assert_eq!(token_client.transfer_count(), 2);

    // Racing reservation on bounty 1 fails and invokes zero token transfers,
    // leaving bounty 2 completely unaffected.
    let race_err = client
        .try_reserve_bounty(&bounty_1, &contributor_2)
        .expect_err("racing reserve must fail");
    assert_eq!(race_err, Ok(contract_err(ContractError::BountyAlreadyReserved)));
    assert_eq!(token_client.transfer_count(), 2);

    let b2 = client.get_bounty(&bounty_2);
    assert_eq!(b2.status, BountyStatus::Open);
    assert_eq!(b2.contributor, None);

    // Second contributor can still cleanly reserve bounty 2 without interference.
    client.reserve_bounty(&bounty_2, &contributor_2);
    assert_eq!(token_client.transfer_count(), 2);
    assert_eq!(
        client.get_bounty(&bounty_2).contributor,
        Some(contributor_2)
    );
}
