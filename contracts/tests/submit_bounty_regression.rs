//! Regression tests for Contract submission (`submit_bounty`, SBB-2026-420).
//!
//! Covers:
//! - Authorized submission of a reserved bounty at the exact deadline boundary
//!   (`ledger.timestamp() == deadline`) with strict `MockAuth` verification,
//!   unchanged escrow/account token balances, `BountyStatus::Submitted` transition,
//!   and exact `(Bounty, Submit)` / `BountySubmitted` event emission.
//! - Rejection of unsigned or wrong-signer submission attempts without mutating
//!   bounty state, moving tokens, or emitting events.
//! - Rejection of callers other than the reserved contributor (outsider, maintainer,
//!   admin, arbiter) with `ContractError::ContributorMismatch` while preserving
//!   reservation state, balances, and event log, followed by successful submission
//!   by the legitimate reserved contributor.
//! - Rejection of submission strictly past the deadline (`deadline + 1`) with
//!   `ContractError::BountyExpired` even with valid contributor authorization.
//! - All tests run in isolated Soroban contract fixtures with no live funds.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Error, FromVal, IntoVal, String, Symbol,
};
use stellar_bounty_board::{
    BountyStatus, BountySubmitted, ContractError, StellarBountyBoardContract,
    StellarBountyBoardContractClient,
};

const BOUNTY_AMOUNT: i128 = 12_345_678;
const DISPUTE_WINDOW: u64 = 600;
const INITIAL_TIMESTAMP: u64 = 100_000;
const DEADLINE_OFFSET: u64 = 3_600;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    token: Address,
    admin: Address,
    fee_recipient: Address,
    arbiter: Address,
    maintainer: Address,
    contributor: Address,
    outsider: Address,
    bounty_id: u64,
    deadline: u64,
}

fn setup_reserved_bounty() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(INITIAL_TIMESTAMP);

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let outsider = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token = sac.address();
    let asset_client = StellarAssetClient::new(&env, &token);
    asset_client.mint(&maintainer, &BOUNTY_AMOUNT);

    client.initialize(&admin, &fee_recipient, &arbiter, &DISPUTE_WINDOW);

    let deadline = INITIAL_TIMESTAMP + DEADLINE_OFFSET;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token,
        &BOUNTY_AMOUNT,
        &String::from_str(&env, "ritik4ever/stellar-bounty-board"),
        &420,
        &String::from_str(&env, "Contract submission regression"),
        &deadline,
        &250u32,
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);

    // Clear blanket mock auths so submission calls enforce strict authorization.
    env.mock_auths(&[]);

    Fixture {
        env,
        client,
        token,
        admin,
        fee_recipient,
        arbiter,
        maintainer,
        contributor,
        outsider,
        bounty_id,
        deadline,
    }
}

fn mock_submit_auth(f: &Fixture, signer: &Address, contributor_arg: &Address) {
    let invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "submit_bounty",
        args: (f.bounty_id, contributor_arg.clone()).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &invoke,
    }]);
}

fn submitted_events(env: &Env, contract: &Address) -> std::vec::Vec<BountySubmitted> {
    let mut found = std::vec::Vec::new();
    for event in env.events().all().filter_by_contract(contract).events() {
        let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
        if body.topics.len() == 2 {
            let t0 = Symbol::from_val(env, &body.topics[0]);
            let t1 = Symbol::from_val(env, &body.topics[1]);
            if t0 == symbol_short!("Bounty") && t1 == symbol_short!("Submit") {
                found.push(BountySubmitted::from_val(env, &body.data));
            }
        }
    }
    found
}

fn assert_balances_unchanged(f: &Fixture) {
    let token_client = TokenClient::new(&f.env, &f.token);
    assert_eq!(token_client.balance(&f.client.address), BOUNTY_AMOUNT);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
    assert_eq!(token_client.balance(&f.outsider), 0);
}

#[test]
fn submit_reserved_bounty_at_exact_deadline_enforces_auth_unchanged_balances_and_event() {
    let f = setup_reserved_bounty();

    // Advance to the exact deadline boundary (`now == deadline`).
    f.env.ledger().set_timestamp(f.deadline);

    assert!(submitted_events(&f.env, &f.client.address).is_empty());
    assert_balances_unchanged(&f);

    // Authorized submission by the reserved contributor at exact deadline.
    mock_submit_auth(&f, &f.contributor, &f.contributor);
    f.client.submit_bounty(&f.bounty_id, &f.contributor);

    // Exactly one BountySubmitted event emitted with expected payload.
    let events = submitted_events(&f.env, &f.client.address);
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        BountySubmitted {
            bounty_id: f.bounty_id,
            contributor: f.contributor.clone(),
        }
    );

    // State transition assertions.
    let bounty = f.client.get_bounty(&f.bounty_id);
    assert_eq!(bounty.status, BountyStatus::Submitted);
    assert_eq!(bounty.contributor, Some(f.contributor.clone()));
    assert_eq!(bounty.amount, BOUNTY_AMOUNT);
    assert_eq!(bounty.deadline, f.deadline);

    // Balances remain strictly unchanged (zero tokens moved on submission).
    assert_balances_unchanged(&f);

    // Duplicate submission by the same authorized contributor is rejected.
    mock_submit_auth(&f, &f.contributor, &f.contributor);
    let dup_res = f.client.try_submit_bounty(&f.bounty_id, &f.contributor);
    let dup_err = dup_res
        .err()
        .expect("duplicate submission should fail")
        .expect("expected typed contract error");
    assert_eq!(
        dup_err,
        Error::from_contract_error(ContractError::BountyMustBeReserved as u32)
    );
    assert!(submitted_events(&f.env, &f.client.address).is_empty());
    assert_balances_unchanged(&f);
}

#[test]
fn submit_reserved_bounty_without_contributor_auth_rejected_without_mutations() {
    let f = setup_reserved_bounty();
    f.env.ledger().set_timestamp(f.deadline);

    // 1. Completely unsigned call must fail authorization.
    f.env.mock_auths(&[]);
    let unsigned_res = f.client.try_submit_bounty(&f.bounty_id, &f.contributor);
    assert!(
        unsigned_res.is_err(),
        "unsigned submit_bounty must be rejected"
    );
    assert!(submitted_events(&f.env, &f.client.address).is_empty());

    // 2. Call signed by outsider while passing the reserved contributor address must fail auth.
    mock_submit_auth(&f, &f.outsider, &f.contributor);
    let wrong_signer_res = f.client.try_submit_bounty(&f.bounty_id, &f.contributor);
    assert!(
        wrong_signer_res.is_err(),
        "submit_bounty signed by non-contributor must be rejected"
    );
    assert!(submitted_events(&f.env, &f.client.address).is_empty());

    // State and balances remain untouched.
    let bounty = f.client.get_bounty(&f.bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);
    assert_eq!(bounty.contributor, Some(f.contributor.clone()));
    assert_balances_unchanged(&f);
}

#[test]
fn submit_reserved_bounty_by_non_reserved_callers_rejected_and_preserves_state_and_balances() {
    let f = setup_reserved_bounty();
    f.env.ledger().set_timestamp(f.deadline);

    let unauthorized_callers = [
        f.outsider.clone(),
        f.maintainer.clone(),
        f.admin.clone(),
        f.arbiter.clone(),
    ];

    for caller in unauthorized_callers {
        mock_submit_auth(&f, &caller, &caller);
        let res = f.client.try_submit_bounty(&f.bounty_id, &caller);
        let err = res
            .err()
            .expect("non-reserved caller submission should fail")
            .expect("expected typed contract error");
        assert_eq!(
            err,
            Error::from_contract_error(ContractError::ContributorMismatch as u32)
        );

        // Each rejected attempt must emit no submit event and leave state and balances unchanged.
        assert!(submitted_events(&f.env, &f.client.address).is_empty());
        let bounty = f.client.get_bounty(&f.bounty_id);
        assert_eq!(bounty.status, BountyStatus::Reserved);
        assert_eq!(bounty.contributor, Some(f.contributor.clone()));
        assert_balances_unchanged(&f);
    }

    // Legitimate reserved contributor can still submit at the exact deadline.
    mock_submit_auth(&f, &f.contributor, &f.contributor);
    f.client.submit_bounty(&f.bounty_id, &f.contributor);

    let events = submitted_events(&f.env, &f.client.address);
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        BountySubmitted {
            bounty_id: f.bounty_id,
            contributor: f.contributor.clone(),
        }
    );

    let bounty = f.client.get_bounty(&f.bounty_id);
    assert_eq!(bounty.status, BountyStatus::Submitted);
    assert_eq!(bounty.contributor, Some(f.contributor.clone()));
    assert_balances_unchanged(&f);
}

#[test]
fn submit_reserved_bounty_one_second_past_deadline_rejected_even_with_valid_auth() {
    let f = setup_reserved_bounty();
    f.env.ledger().set_timestamp(f.deadline + 1);

    mock_submit_auth(&f, &f.contributor, &f.contributor);
    let res = f.client.try_submit_bounty(&f.bounty_id, &f.contributor);
    let err = res
        .err()
        .expect("submission one second past deadline should fail")
        .expect("expected typed contract error");
    assert_eq!(
        err,
        Error::from_contract_error(ContractError::BountyExpired as u32)
    );

    assert!(submitted_events(&f.env, &f.client.address).is_empty());
    assert_balances_unchanged(&f);
}
