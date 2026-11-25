//! Integration tests for Arbiter resolution boundaries (SBB-2026-436, #1905).
//!
//! Exercises `resolve_dispute` across both payout destinations with exact
//! ledger timestamps and exact non-round integer token units:
//! - Exact dispute window boundary (`now == dispute_raised_at + window` vs `window - 1`),
//!   covering both global `DisputeWindow` and per-bounty `dispute_window_override`.
//! - Exact destination balances and fee flooring for `release = true` (contributor +
//!   `fee_recipient`) and full zero-fee refund for `release = false` (maintainer).
//! - Fee truncation boundary where `floor(amount * fee_bps / 10_000) == 0`.
//! - One final decision: once settled (`Released` or `Refunded`), conflicting and
//!   duplicate resolutions fail with `BountyMustBeDisputed` without moving funds.
//! - Non-disputed statuses (`Open`, `Reserved`, `Submitted`) are rejected with
//!   `BountyMustBeDisputed` while preserving escrow balances.
//! - Strict arbiter authorization prevents non-arbiter roles from altering
//!   payout destinations or final decisions.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, FromVal, IntoVal, String, Val, Vec,
};
use stellar_bounty_board::{
    BountyResolved, BountyStatus, Error as ContractError, StellarBountyBoardContract,
    StellarBountyBoardContractClient,
};

const GLOBAL_DISPUTE_WINDOW: u64 = 600;
const INITIAL_LEDGER_TS: u64 = 50_000;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    token: Address,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
    admin: Address,
    fee_recipient: Address,
}

fn setup_env() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(INITIAL_LEDGER_TS);

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token = sac.address();

    client.initialize(&admin, &fee_recipient, &arbiter, &GLOBAL_DISPUTE_WINDOW);

    Fixture {
        env,
        client,
        token,
        maintainer,
        contributor,
        arbiter,
        admin,
        fee_recipient,
    }
}

fn create_disputed_bounty(
    f: &Fixture,
    amount: i128,
    fee_bps: u32,
    window_override: Option<u64>,
) -> (u64, u64) {
    let sac = StellarAssetClient::new(&f.env, &f.token);
    sac.mint(&f.maintainer, &amount);

    let deadline = f.env.ledger().timestamp() + 10_000;
    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.token,
        &amount,
        &String::from_str(&f.env, "ritik4ever/stellar-bounty-board"),
        &1905,
        &String::from_str(&f.env, "Arbiter resolution boundary"),
        &deadline,
        &fee_bps,
        &window_override,
    );

    f.client.reserve_bounty(&bounty_id, &f.contributor);
    f.client.submit_bounty(&bounty_id, &f.contributor);

    let dispute_raised_at = f.env.ledger().timestamp();
    f.client.dispute_bounty(&bounty_id, &f.arbiter);

    (bounty_id, dispute_raised_at)
}

fn mock_resolve_auth(f: &Fixture, signer: &Address, bounty_id: u64, release: bool) {
    let invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "resolve_dispute",
        args: (bounty_id, release).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &invoke,
    }]);
}

fn resolved_events(env: &Env, contract: &Address) -> std::vec::Vec<BountyResolved> {
    let expected_topic: Vec<Val> =
        (symbol_short!("Bounty"), symbol_short!("Reslv")).into_val(env);
    let mut found = std::vec::Vec::new();
    for (addr, topics, data) in env.events().all().iter() {
        if addr == *contract && topics == expected_topic {
            found.push(BountyResolved::from_val(env, &data));
        }
    }
    found
}

#[test]
fn resolve_dispute_at_exact_window_boundary_releases_exact_token_units_to_contributor() {
    let f = setup_env();
    let token_client = TokenClient::new(&f.env, &f.token);

    let exact_amount: i128 = 1_234_567;
    let fee_bps: u32 = 250; // 2.5%
    let (bounty_id, dispute_raised_at) = create_disputed_bounty(&f, exact_amount, fee_bps, None);

    // One ledger second before the dispute window elapses: must fail
    f.env
        .ledger()
        .set_timestamp(dispute_raised_at + GLOBAL_DISPUTE_WINDOW - 1);
    let too_early = f.client.try_resolve_dispute(&bounty_id, &true);
    assert_eq!(
        too_early,
        Err(Ok(ContractError::DisputeWindowNotMet)),
        "resolution one second before window must fail with DisputeWindowNotMet"
    );
    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Disputed);
    assert_eq!(token_client.balance(&f.client.address), exact_amount);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert!(resolved_events(&f.env, &f.client.address).is_empty());

    // Exact ledger boundary: now == dispute_raised_at + GLOBAL_DISPUTE_WINDOW
    f.env
        .ledger()
        .set_timestamp(dispute_raised_at + GLOBAL_DISPUTE_WINDOW);
    f.client.resolve_dispute(&bounty_id, &true);

    // Exact integer unit accounting: floor(1_234_567 * 250 / 10_000) = 30_864
    let expected_fee: i128 = (exact_amount * fee_bps as i128) / 10_000;
    let expected_net: i128 = exact_amount - expected_fee;
    assert_eq!(expected_fee, 30_864);
    assert_eq!(expected_net, 1_203_703);
    assert_eq!(expected_net + expected_fee, exact_amount);

    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Released);
    assert_eq!(token_client.balance(&f.contributor), expected_net);
    assert_eq!(token_client.balance(&f.fee_recipient), expected_fee);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);

    let events = resolved_events(&f.env, &f.client.address);
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        BountyResolved {
            bounty_id,
            arbiter: f.arbiter.clone(),
            release: true,
            amount: exact_amount,
        }
    );

    // One final decision: conflicting and duplicate resolutions are rejected
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &false),
        Err(Ok(ContractError::BountyMustBeDisputed))
    );
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &true),
        Err(Ok(ContractError::BountyMustBeDisputed))
    );
    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Released);
    assert_eq!(token_client.balance(&f.contributor), expected_net);
    assert_eq!(token_client.balance(&f.fee_recipient), expected_fee);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);
}

#[test]
fn resolve_dispute_at_exact_override_window_boundary_refunds_exact_token_units_to_maintainer() {
    let f = setup_env();
    let token_client = TokenClient::new(&f.env, &f.token);

    let exact_amount: i128 = 1_234_567;
    let fee_bps: u32 = 250; // Must not be charged on refund
    let custom_window: u64 = 900;
    let (bounty_id, dispute_raised_at) =
        create_disputed_bounty(&f, exact_amount, fee_bps, Some(custom_window));

    // Past global window (600s) but one second before custom override (900s): must fail
    f.env
        .ledger()
        .set_timestamp(dispute_raised_at + custom_window - 1);
    let too_early = f.client.try_resolve_dispute(&bounty_id, &false);
    assert_eq!(
        too_early,
        Err(Ok(ContractError::DisputeWindowNotMet)),
        "resolution one second before custom override window must fail with DisputeWindowNotMet"
    );
    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Disputed);
    assert_eq!(token_client.balance(&f.client.address), exact_amount);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);

    // Exact custom override boundary: now == dispute_raised_at + custom_window
    f.env
        .ledger()
        .set_timestamp(dispute_raised_at + custom_window);
    f.client.resolve_dispute(&bounty_id, &false);

    // Full exact token units returned to maintainer with zero fee deduction
    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Refunded);
    assert_eq!(token_client.balance(&f.maintainer), exact_amount);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);

    let events = resolved_events(&f.env, &f.client.address);
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        BountyResolved {
            bounty_id,
            arbiter: f.arbiter.clone(),
            release: false,
            amount: exact_amount,
        }
    );

    // One final decision: conflicting and duplicate resolutions are rejected
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &true),
        Err(Ok(ContractError::BountyMustBeDisputed))
    );
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &false),
        Err(Ok(ContractError::BountyMustBeDisputed))
    );
    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Refunded);
    assert_eq!(token_client.balance(&f.maintainer), exact_amount);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);
}

#[test]
fn resolve_dispute_fee_truncation_preserves_exact_units_to_contributor() {
    let f = setup_env();
    let token_client = TokenClient::new(&f.env, &f.token);

    // floor(123 * 50 / 10_000) == 0 -> contributor receives full 123 units
    let exact_amount: i128 = 123;
    let fee_bps: u32 = 50;
    let (bounty_id, dispute_raised_at) = create_disputed_bounty(&f, exact_amount, fee_bps, None);

    f.env
        .ledger()
        .set_timestamp(dispute_raised_at + GLOBAL_DISPUTE_WINDOW);
    f.client.resolve_dispute(&bounty_id, &true);

    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Released);
    assert_eq!(token_client.balance(&f.contributor), exact_amount);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);
}

#[test]
fn resolve_dispute_rejects_non_disputed_statuses_and_preserves_escrow() {
    let f = setup_env();
    let token_client = TokenClient::new(&f.env, &f.token);
    let sac = StellarAssetClient::new(&f.env, &f.token);

    let amount: i128 = 5_432;
    sac.mint(&f.maintainer, &amount);

    let deadline = f.env.ledger().timestamp() + 10_000;
    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.token,
        &amount,
        &String::from_str(&f.env, "ritik4ever/stellar-bounty-board"),
        &1905,
        &String::from_str(&f.env, "Non-disputed status boundary"),
        &deadline,
        &100,
        &None,
    );

    // Open
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &true),
        Err(Ok(ContractError::BountyMustBeDisputed))
    );
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &false),
        Err(Ok(ContractError::BountyMustBeDisputed))
    );
    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Open);
    assert_eq!(token_client.balance(&f.client.address), amount);

    // Reserved
    f.client.reserve_bounty(&bounty_id, &f.contributor);
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &true),
        Err(Ok(ContractError::BountyMustBeDisputed))
    );
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &false),
        Err(Ok(ContractError::BountyMustBeDisputed))
    );
    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Reserved);
    assert_eq!(token_client.balance(&f.client.address), amount);

    // Submitted
    f.client.submit_bounty(&bounty_id, &f.contributor);
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &true),
        Err(Ok(ContractError::BountyMustBeDisputed))
    );
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &false),
        Err(Ok(ContractError::BountyMustBeDisputed))
    );
    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Submitted);
    assert_eq!(token_client.balance(&f.client.address), amount);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.contributor), 0);
}

#[test]
fn resolve_dispute_unauthorized_callers_cannot_alter_destination_or_final_decision() {
    let f = setup_env();
    let token_client = TokenClient::new(&f.env, &f.token);
    let outsider = Address::generate(&f.env);

    let exact_amount: i128 = 987_654;
    let (bounty_id, dispute_raised_at) = create_disputed_bounty(&f, exact_amount, 0, None);

    f.env
        .ledger()
        .set_timestamp(dispute_raised_at + GLOBAL_DISPUTE_WINDOW);
    f.env.mock_auths(&[]);

    let expected_auth_err = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));

    for (caller, release) in [
        (&f.maintainer, false),
        (&f.contributor, true),
        (&f.admin, true),
        (&outsider, false),
    ] {
        mock_resolve_auth(&f, caller, bounty_id, release);
        assert_eq!(
            f.client.try_resolve_dispute(&bounty_id, &release),
            Err(Ok(expected_auth_err))
        );
    }

    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Disputed);
    assert_eq!(token_client.balance(&f.client.address), exact_amount);

    // Registered arbiter settles to maintainer cleanly at the exact boundary
    mock_resolve_auth(&f, &f.arbiter, bounty_id, false);
    f.client.resolve_dispute(&bounty_id, &false);

    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Refunded);
    assert_eq!(token_client.balance(&f.maintainer), exact_amount);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);
    assert_eq!(resolved_events(&f.env, &f.client.address).len(), 1);
}
