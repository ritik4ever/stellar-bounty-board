//! Regression coverage for contract reservation (`reserve_bounty`) at expiry boundaries
//! and under concurrent contributor contention.
//!
//! Covers:
//! - Reservation exactly at the expiry ledger (`timestamp == deadline`) succeeding for
//!   the first contributor while a second contributor racing to reserve is rejected with
//!   `BountyAlreadyReserved`.
//! - Reservation immediately past the expiry ledger (`timestamp == deadline + 1`) being
//!   rejected with `BountyExpired` without assigning any contributor.
//! - A second contributor racing after an existing reservation expires being rejected
//!   with `BountyExpired` while preserving the original single contributor.
//! - Strict contributor authorization (`contributor.require_auth()`) rejecting spoofed
//!   signers and unsigned calls during the race.
//! - Locked escrow token balances, single-contributor ownership, and exact
//!   `BountyReserved` event emissions in isolated contract fixtures (no live funds).

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, FromVal, IntoVal, String, Val, Vec,
};
use stellar_bounty_board::{
    BountyReserved, BountyStatus, Error as ContractError, StellarBountyBoardContract,
    StellarBountyBoardContractClient,
};

const BOUNTY_AMOUNT: i128 = 10_000;
const DISPUTE_WINDOW: u64 = 600;
const DEADLINE_OFFSET: u64 = 5_000;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    token: Address,
    maintainer: Address,
    contributor_a: Address,
    contributor_b: Address,
    arbiter: Address,
    admin: Address,
    fee_recipient: Address,
    bounty_id: u64,
    deadline: u64,
}

fn setup_open_bounty() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor_a = Address::generate(&env);
    let contributor_b = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token = sac.address();
    let asset_client = StellarAssetClient::new(&env, &token);
    asset_client.mint(&maintainer, &BOUNTY_AMOUNT);

    client.initialize(&admin, &fee_recipient, &arbiter, &DISPUTE_WINDOW);

    let repo = String::from_str(&env, "org/repo");
    let title = String::from_str(&env, "Contract reservation regression");
    let deadline = env.ledger().timestamp() + DEADLINE_OFFSET;

    let bounty_id = client.create_bounty(
        &maintainer,
        &token,
        &BOUNTY_AMOUNT,
        &repo,
        &415,
        &title,
        &deadline,
        &250,
        &None,
    );

    // Clear blanket mock auths so all reservation calls enforce strict authorization.
    env.mock_auths(&[]);

    Fixture {
        env,
        client,
        token,
        maintainer,
        contributor_a,
        contributor_b,
        arbiter,
        admin,
        fee_recipient,
        bounty_id,
        deadline,
    }
}

fn mock_reserve_auth(f: &Fixture, signer: &Address, contributor_arg: &Address) {
    let invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "reserve_bounty",
        args: (f.bounty_id, contributor_arg.clone()).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &invoke,
    }]);
}

fn reserved_events(env: &Env, contract: &Address) -> std::vec::Vec<BountyReserved> {
    let expected_topic: Vec<Val> =
        (symbol_short!("Bounty"), symbol_short!("Reserv")).into_val(env);
    let mut found = std::vec::Vec::new();
    for (addr, topics, data) in env.events().all().iter() {
        if addr == *contract && topics == expected_topic {
            found.push(BountyReserved::from_val(env, &data));
        }
    }
    found
}

fn assert_escrow_locked(f: &Fixture, token_client: &TokenClient) {
    assert_eq!(token_client.balance(&f.client.address), BOUNTY_AMOUNT);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.contributor_a), 0);
    assert_eq!(token_client.balance(&f.contributor_b), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
}

#[test]
fn reservation_at_exact_expiry_ledger_locks_single_contributor_and_rejects_racing_contributor() {
    let f = setup_open_bounty();
    let token_client = TokenClient::new(&f.env, &f.token);

    // Advance ledger to the exact expiry boundary (`timestamp == deadline`).
    f.env.ledger().set_timestamp(f.deadline);

    // Pre-reservation invariants: bounty is Open with funds locked in escrow.
    let before = f.client.get_bounty(&f.bounty_id);
    assert_eq!(before.status, BountyStatus::Open);
    assert_eq!(before.contributor, None);
    assert_escrow_locked(&f, &token_client);
    assert!(reserved_events(&f.env, &f.client.address).is_empty());

    // First contributor reserves at exact expiry ledger -> succeeds.
    mock_reserve_auth(&f, &f.contributor_a, &f.contributor_a);
    f.client.reserve_bounty(&f.bounty_id, &f.contributor_a);

    let after_first = f.client.get_bounty(&f.bounty_id);
    assert_eq!(after_first.status, BountyStatus::Reserved);
    assert_eq!(after_first.contributor, Some(f.contributor_a.clone()));
    assert_escrow_locked(&f, &token_client);

    let events = reserved_events(&f.env, &f.client.address);
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        BountyReserved {
            bounty_id: f.bounty_id,
            contributor: f.contributor_a.clone(),
        }
    );

    // Second contributor races to reserve at the same expiry ledger -> rejected.
    mock_reserve_auth(&f, &f.contributor_b, &f.contributor_b);
    let race_result = f.client.try_reserve_bounty(&f.bounty_id, &f.contributor_b);
    assert_eq!(
        race_result,
        Err(Ok(ContractError::BountyAlreadyReserved)),
        "second contributor racing to reserve must fail with BountyAlreadyReserved"
    );

    // Single-contributor ownership, locked escrow, and emitted events remain unchanged.
    let after_race = f.client.get_bounty(&f.bounty_id);
    assert_eq!(after_race.status, BountyStatus::Reserved);
    assert_eq!(after_race.contributor, Some(f.contributor_a.clone()));
    assert_escrow_locked(&f, &token_client);
    assert_eq!(reserved_events(&f.env, &f.client.address).len(), 1);
}

#[test]
fn reservation_one_second_past_expiry_ledger_is_rejected_and_preserves_escrow() {
    let f = setup_open_bounty();
    let token_client = TokenClient::new(&f.env, &f.token);

    // Advance ledger strictly past the expiry boundary (`timestamp == deadline + 1`).
    f.env.ledger().set_timestamp(f.deadline + 1);

    // Both contributors attempting to reserve past expiry must be rejected.
    for contributor in [&f.contributor_a, &f.contributor_b] {
        mock_reserve_auth(&f, contributor, contributor);
        let result = f.client.try_reserve_bounty(&f.bounty_id, contributor);
        assert_eq!(
            result,
            Err(Ok(ContractError::BountyExpired)),
            "reservation past expiry ledger must fail with BountyExpired"
        );
    }

    // Bounty is expired with no contributor assigned, escrow stays locked, no events emitted.
    let bounty = f.client.get_bounty(&f.bounty_id);
    assert_eq!(bounty.status, BountyStatus::Expired);
    assert_eq!(bounty.contributor, None);
    assert_escrow_locked(&f, &token_client);
    assert!(reserved_events(&f.env, &f.client.address).is_empty());
}

#[test]
fn racing_contributor_after_reservation_expires_is_rejected_without_overwriting_contributor() {
    let f = setup_open_bounty();
    let token_client = TokenClient::new(&f.env, &f.token);

    // First contributor reserves right at the expiry ledger.
    f.env.ledger().set_timestamp(f.deadline);
    mock_reserve_auth(&f, &f.contributor_a, &f.contributor_a);
    f.client.reserve_bounty(&f.bounty_id, &f.contributor_a);

    // Ledger advances past expiry; second contributor races to take over.
    f.env.ledger().set_timestamp(f.deadline + 1);
    mock_reserve_auth(&f, &f.contributor_b, &f.contributor_b);
    let race_result = f.client.try_reserve_bounty(&f.bounty_id, &f.contributor_b);
    assert_eq!(
        race_result,
        Err(Ok(ContractError::BountyExpired)),
        "racing contributor after expiry must fail with BountyExpired"
    );

    // Original contributor record, locked escrow, and single event remain intact.
    let bounty = f.client.get_bounty(&f.bounty_id);
    assert_eq!(bounty.status, BountyStatus::Expired);
    assert_eq!(bounty.contributor, Some(f.contributor_a.clone()));
    assert_escrow_locked(&f, &token_client);
    let events = reserved_events(&f.env, &f.client.address);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].contributor, f.contributor_a);
}

#[test]
fn unauthorized_and_unsigned_reservation_attempts_at_expiry_ledger_preserve_state_and_escrow() {
    let f = setup_open_bounty();
    let token_client = TokenClient::new(&f.env, &f.token);
    let outsider = Address::generate(&f.env);

    f.env.ledger().set_timestamp(f.deadline);

    let expected_auth_err = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));

    // Wrong signers attempting to reserve on behalf of contributor_a.
    for signer in [
        &f.contributor_b,
        &f.maintainer,
        &f.arbiter,
        &f.admin,
        &outsider,
    ] {
        mock_reserve_auth(&f, signer, &f.contributor_a);
        let result = f.client.try_reserve_bounty(&f.bounty_id, &f.contributor_a);
        assert_eq!(
            result,
            Err(Ok(expected_auth_err)),
            "spoofed signer must be rejected with authorization error"
        );
    }

    // Unsigned reservation attempt.
    f.env.mock_auths(&[]);
    let unsigned = f.client.try_reserve_bounty(&f.bounty_id, &f.contributor_a);
    assert_eq!(
        unsigned,
        Err(Ok(expected_auth_err)),
        "unsigned reservation must be rejected with authorization error"
    );

    // Bounty remains Open, escrow untouched, no BountyReserved events emitted.
    let bounty = f.client.get_bounty(&f.bounty_id);
    assert_eq!(bounty.status, BountyStatus::Open);
    assert_eq!(bounty.contributor, None);
    assert_escrow_locked(&f, &token_client);
    assert!(reserved_events(&f.env, &f.client.address).is_empty());

    // Legitimate contributor can still reserve cleanly at the exact expiry ledger.
    mock_reserve_auth(&f, &f.contributor_a, &f.contributor_a);
    f.client.reserve_bounty(&f.bounty_id, &f.contributor_a);

    let reserved = f.client.get_bounty(&f.bounty_id);
    assert_eq!(reserved.status, BountyStatus::Reserved);
    assert_eq!(reserved.contributor, Some(f.contributor_a.clone()));
    assert_escrow_locked(&f, &token_client);
    let events = reserved_events(&f.env, &f.client.address);
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        BountyReserved {
            bounty_id: f.bounty_id,
            contributor: f.contributor_a.clone(),
        }
    );
}
