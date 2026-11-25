//! Focused integration tests for arbiter resolution event fields and ordering (SBB-2026-439).
//!
//! Verifies that off-chain consumers can reconstruct a committed `resolve_dispute`
//! decision exactly once from contract events alone (no live funds):
//! - Exact deterministic event ordering: `("Escrow", "Balance")` strictly precedes
//!   `("Bounty", "Reslv")`, and no other contract events are emitted by `resolve_dispute`.
//! - Exact `BountyResolved` fields for both final decisions (`release = true` to
//!   contributor with protocol fee, `release = false` to maintainer with zero fee):
//!   `bounty_id`, `arbiter`, `release`, `amount`, `destination`, `token`,
//!   `net_amount`, `fee_amount`, `resolved_at`.
//! - Failed, premature, unauthorized, duplicate, or conflicting resolution calls
//!   emit zero `("Escrow", "Balance")` and zero `("Bounty", "Reslv")` events.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    xdr::{ContractEventBody, ScVal},
    Address, Env, FromVal, IntoVal, String, Symbol, Vec,
};
use stellar_bounty_board::{
    BountyResolved, BountyStatus, ContractError, StellarBountyBoardContract,
    StellarBountyBoardContractClient,
};

const DISPUTE_WINDOW: u64 = 600;
const INITIAL_TS: u64 = 100_000;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    token: Address,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
    fee_recipient: Address,
}

fn setup_fixture() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(INITIAL_TS);

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

    client.initialize(&admin, &fee_recipient, &arbiter, &DISPUTE_WINDOW);

    Fixture {
        env,
        client,
        token,
        maintainer,
        contributor,
        arbiter,
        fee_recipient,
    }
}

fn create_disputed_bounty(f: &Fixture, amount: i128, fee_bps: u32) -> (u64, u64) {
    let sac = StellarAssetClient::new(&f.env, &f.token);
    sac.mint(&f.maintainer, &amount);

    let deadline = f.env.ledger().timestamp() + 10_000;
    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.token,
        &amount,
        &String::from_str(&f.env, "org/repo"),
        &439,
        &String::from_str(&f.env, "Arbiter resolution events"),
        &deadline,
        &fee_bps,
        &None,
    );

    f.client.reserve_bounty(&bounty_id, &f.contributor);
    f.client.submit_bounty(&bounty_id, &f.contributor);
    let disputed_at = f.env.ledger().timestamp();
    f.client.dispute_bounty(&bounty_id, &f.arbiter);

    (bounty_id, disputed_at)
}

/// Returns `(topic0, topic1, data)` for all events emitted by `contract` in the
/// most recent invocation.
fn contract_events(env: &Env, contract: &Address) -> std::vec::Vec<(Symbol, Symbol, ScVal)> {
    let mut out = std::vec::Vec::new();
    let filtered = env.events().all().filter_by_contract(contract);
    for event in filtered.events() {
        let ContractEventBody::V0(body) = &event.body;
        if body.topics.len() < 2 {
            continue;
        }
        let t0 = Symbol::from_val(env, &body.topics[0]);
        let t1 = Symbol::from_val(env, &body.topics[1]);
        out.push((t0, t1, body.data.clone()));
    }
    out
}

#[test]
fn resolve_dispute_release_emits_ordered_events_with_exact_contributor_destination() {
    let f = setup_fixture();
    let token_client = TokenClient::new(&f.env, &f.token);
    let amount: i128 = 10_005;
    let fee_bps: u32 = 250; // 2.5% -> floor(10_005 * 250 / 10_000) = 250
    let (bounty_id, disputed_at) = create_disputed_bounty(&f, amount, fee_bps);

    let resolve_ts = disputed_at + DISPUTE_WINDOW;
    f.env.ledger().set_timestamp(resolve_ts);
    f.client.resolve_dispute(&bounty_id, &true);

    // Inspect events emitted by the `resolve_dispute` invocation in exact order.
    let events = contract_events(&f.env, &f.client.address);
    assert_eq!(
        events.len(),
        2,
        "resolve_dispute must emit exactly 2 contract events: Escrow/Balance then Bounty/Reslv"
    );
    assert_eq!(
        (events[0].0.clone(), events[0].1.clone()),
        (symbol_short!("Escrow"), symbol_short!("Balance")),
        "first event must be (Escrow, Balance)"
    );
    assert_eq!(
        (events[1].0.clone(), events[1].1.clone()),
        (symbol_short!("Bounty"), symbol_short!("Reslv")),
        "second event must be (Bounty, Reslv)"
    );

    let expected_fee: i128 = (amount * fee_bps as i128) / 10_000;
    let expected_net: i128 = amount - expected_fee;
    let payload = BountyResolved::from_val(&f.env, &events[1].2);
    assert_eq!(
        payload,
        BountyResolved {
            bounty_id,
            arbiter: f.arbiter.clone(),
            release: true,
            amount,
            destination: f.contributor.clone(),
            token: f.token.clone(),
            net_amount: expected_net,
            fee_amount: expected_fee,
            resolved_at: resolve_ts,
        }
    );

    // Consumer reconstruction check: event fields alone match committed storage & balances.
    let reconstructed_status = if payload.release {
        BountyStatus::Released
    } else {
        BountyStatus::Refunded
    };
    assert_eq!(payload.net_amount + payload.fee_amount, payload.amount);
    assert_eq!(f.client.get_bounty(&bounty_id).status, reconstructed_status);
    assert_eq!(token_client.balance(&payload.destination), payload.net_amount);
    assert_eq!(token_client.balance(&f.fee_recipient), payload.fee_amount);
    assert_eq!(token_client.balance(&f.client.address), 0);
}

#[test]
fn resolve_dispute_refund_emits_ordered_events_with_exact_maintainer_destination() {
    let f = setup_fixture();
    let token_client = TokenClient::new(&f.env, &f.token);
    let amount: i128 = 7_777;
    let fee_bps: u32 = 500; // Must not be charged on refund
    let (bounty_id, disputed_at) = create_disputed_bounty(&f, amount, fee_bps);

    let resolve_ts = disputed_at + DISPUTE_WINDOW + 42;
    f.env.ledger().set_timestamp(resolve_ts);
    f.client.resolve_dispute(&bounty_id, &false);

    let events = contract_events(&f.env, &f.client.address);
    assert_eq!(
        events.len(),
        2,
        "resolve_dispute must emit exactly 2 contract events: Escrow/Balance then Bounty/Reslv"
    );
    assert_eq!(
        (events[0].0.clone(), events[0].1.clone()),
        (symbol_short!("Escrow"), symbol_short!("Balance"))
    );
    assert_eq!(
        (events[1].0.clone(), events[1].1.clone()),
        (symbol_short!("Bounty"), symbol_short!("Reslv"))
    );

    let payload = BountyResolved::from_val(&f.env, &events[1].2);
    assert_eq!(
        payload,
        BountyResolved {
            bounty_id,
            arbiter: f.arbiter.clone(),
            release: false,
            amount,
            destination: f.maintainer.clone(),
            token: f.token.clone(),
            net_amount: amount,
            fee_amount: 0,
            resolved_at: resolve_ts,
        }
    );

    // Consumer reconstruction check: event fields alone match committed storage & balances.
    let reconstructed_status = if payload.release {
        BountyStatus::Released
    } else {
        BountyStatus::Refunded
    };
    assert_eq!(payload.net_amount + payload.fee_amount, payload.amount);
    assert_eq!(f.client.get_bounty(&bounty_id).status, reconstructed_status);
    assert_eq!(token_client.balance(&payload.destination), payload.net_amount);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);
}

#[test]
fn failed_and_duplicate_resolutions_emit_no_events() {
    let f = setup_fixture();
    let (bounty_id, disputed_at) = create_disputed_bounty(&f, 5_000, 100);

    // 1. Premature resolution (before dispute window) emits zero contract events.
    f.env.ledger().set_timestamp(disputed_at + DISPUTE_WINDOW - 1);
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &true),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            ContractError::DisputeWindowNotMet as u32
        )))
    );
    assert!(
        contract_events(&f.env, &f.client.address).is_empty(),
        "rejected premature resolution must emit zero contract events"
    );

    // 2. Unauthorized caller emits zero contract events.
    f.env.ledger().set_timestamp(disputed_at + DISPUTE_WINDOW);
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "resolve_dispute",
            args: Vec::from_array(
                &f.env,
                [bounty_id.into_val(&f.env), false.into_val(&f.env)],
            ),
            sub_invokes: &[],
        },
    }]);
    assert!(f.client.try_resolve_dispute(&bounty_id, &false).is_err());
    assert!(
        contract_events(&f.env, &f.client.address).is_empty(),
        "unauthorized resolution must emit zero contract events"
    );

    // 3. Committed resolution emits exactly one Escrow/Balance and one Bounty/Reslv.
    f.env.mock_all_auths();
    f.client.resolve_dispute(&bounty_id, &true);
    assert_eq!(contract_events(&f.env, &f.client.address).len(), 2);

    // 4. Subsequent conflicting or duplicate resolutions fail and emit zero events.
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &false),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            ContractError::BountyMustBeDisputed as u32
        )))
    );
    assert!(
        contract_events(&f.env, &f.client.address).is_empty(),
        "conflicting post-settlement resolution must emit zero contract events"
    );

    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &true),
        Err(Ok(soroban_sdk::Error::from_contract_error(
            ContractError::BountyMustBeDisputed as u32
        )))
    );
    assert!(
        contract_events(&f.env, &f.client.address).is_empty(),
        "duplicate post-settlement resolution must emit zero contract events"
    );
}
