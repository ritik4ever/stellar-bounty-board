//! Regression coverage for arbiter dispute resolution (`resolve_dispute`).
//!
//! Covers:
//! - Arbiter choosing either payout destination (`release = true` to contributor
//!   with protocol fee deduction, `release = false` to maintainer with full refund).
//! - Non-arbiter roles (maintainer, contributor, admin, outsider) and unsigned
//!   callers attempting a conflicting resolution before or after settlement.
//! - One final decision: once settled, subsequent or conflicting resolutions are
//!   rejected with `BountyMustBeDisputed` without moving funds or emitting events.
//! - Exact authorization, token balances, terminal status, and `BountyResolved`
//!   event payloads in isolated contract fixtures (no live funds).

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

const BOUNTY_AMOUNT: i128 = 10_000;
const DISPUTE_WINDOW: u64 = 600;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    token: Address,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
    admin: Address,
    fee_recipient: Address,
    bounty_id: u64,
}

fn setup_disputed_bounty(fee_bps: u32) -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

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
    let asset_client = StellarAssetClient::new(&env, &token);
    asset_client.mint(&maintainer, &BOUNTY_AMOUNT);

    client.initialize(&admin, &fee_recipient, &arbiter, &DISPUTE_WINDOW);

    let repo = String::from_str(&env, "org/repo");
    let title = String::from_str(&env, "Arbiter resolution regression");
    let deadline = env.ledger().timestamp() + 10_000;

    let bounty_id = client.create_bounty(
        &maintainer,
        &token,
        &BOUNTY_AMOUNT,
        &repo,
        &440,
        &title,
        &deadline,
        &fee_bps,
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);
    client.dispute_bounty(&bounty_id, &arbiter);

    // Advance ledger past the dispute window so `resolve_dispute` is eligible.
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + DISPUTE_WINDOW + 1);

    // Clear blanket mock auths so resolution calls enforce strict authorization.
    env.mock_auths(&[]);

    Fixture {
        env,
        client,
        token,
        maintainer,
        contributor,
        arbiter,
        admin,
        fee_recipient,
        bounty_id,
    }
}

fn mock_resolve_auth(f: &Fixture, signer: &Address, release: bool) {
    let invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "resolve_dispute",
        args: (f.bounty_id, release).into_val(&f.env),
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
fn arbiter_resolution_release_to_contributor_enforces_destination_balances_events_and_finality() {
    let fee_bps = 250u32; // 2.5%
    let f = setup_disputed_bounty(fee_bps);
    let token_client = TokenClient::new(&f.env, &f.token);

    // Pre-resolution escrow state
    assert_eq!(token_client.balance(&f.client.address), BOUNTY_AMOUNT);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);

    // Arbiter resolves in favor of contributor (`release = true`)
    mock_resolve_auth(&f, &f.arbiter, true);
    f.client.resolve_dispute(&f.bounty_id, &true);

    let expected_fee = (BOUNTY_AMOUNT * fee_bps as i128) / 10_000;
    let expected_net = BOUNTY_AMOUNT - expected_fee;

    // Terminal state and exact payout destination balances
    let bounty = f.client.get_bounty(&f.bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);
    assert_eq!(token_client.balance(&f.contributor), expected_net);
    assert_eq!(token_client.balance(&f.fee_recipient), expected_fee);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);

    // Exact emitted BountyResolved event
    let events = resolved_events(&f.env, &f.client.address);
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        BountyResolved {
            bounty_id: f.bounty_id,
            arbiter: f.arbiter.clone(),
            release: true,
            amount: BOUNTY_AMOUNT,
            destination: f.contributor.clone(),
            token: f.token.clone(),
            net_amount: expected_net,
            fee_amount: expected_fee,
            resolved_at: f.env.ledger().timestamp(),
        }
    );

    // One final decision: conflicting resolution (`release = false`) by arbiter is rejected
    mock_resolve_auth(&f, &f.arbiter, false);
    let conflicting = f.client.try_resolve_dispute(&f.bounty_id, &false);
    assert_eq!(
        conflicting,
        Err(Ok(ContractError::BountyMustBeDisputed)),
        "conflicting resolution after release must fail with BountyMustBeDisputed"
    );

    // Duplicate resolution (`release = true`) by arbiter is also rejected
    mock_resolve_auth(&f, &f.arbiter, true);
    let duplicate = f.client.try_resolve_dispute(&f.bounty_id, &true);
    assert_eq!(
        duplicate,
        Err(Ok(ContractError::BountyMustBeDisputed)),
        "duplicate resolution after release must fail with BountyMustBeDisputed"
    );

    // State and balances remain unchanged
    assert_eq!(f.client.get_bounty(&f.bounty_id).status, BountyStatus::Released);
    assert_eq!(token_client.balance(&f.contributor), expected_net);
    assert_eq!(token_client.balance(&f.fee_recipient), expected_fee);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);
}

#[test]
fn arbiter_resolution_refund_to_maintainer_enforces_destination_balances_events_and_finality() {
    let f = setup_disputed_bounty(250);
    let token_client = TokenClient::new(&f.env, &f.token);

    // Arbiter resolves in favor of maintainer (`release = false`)
    mock_resolve_auth(&f, &f.arbiter, false);
    f.client.resolve_dispute(&f.bounty_id, &false);

    // Terminal state and exact refund destination balances (no fee deducted on refund)
    let bounty = f.client.get_bounty(&f.bounty_id);
    assert_eq!(bounty.status, BountyStatus::Refunded);
    assert_eq!(token_client.balance(&f.maintainer), BOUNTY_AMOUNT);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);

    // Exact emitted BountyResolved event
    let events = resolved_events(&f.env, &f.client.address);
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        BountyResolved {
            bounty_id: f.bounty_id,
            arbiter: f.arbiter.clone(),
            release: false,
            amount: BOUNTY_AMOUNT,
            destination: f.maintainer.clone(),
            token: f.token.clone(),
            net_amount: BOUNTY_AMOUNT,
            fee_amount: 0,
            resolved_at: f.env.ledger().timestamp(),
        }
    );

    // One final decision: conflicting resolution (`release = true`) by arbiter is rejected
    mock_resolve_auth(&f, &f.arbiter, true);
    let conflicting = f.client.try_resolve_dispute(&f.bounty_id, &true);
    assert_eq!(
        conflicting,
        Err(Ok(ContractError::BountyMustBeDisputed)),
        "conflicting resolution after refund must fail with BountyMustBeDisputed"
    );

    // State and balances remain unchanged
    assert_eq!(f.client.get_bounty(&f.bounty_id).status, BountyStatus::Refunded);
    assert_eq!(token_client.balance(&f.maintainer), BOUNTY_AMOUNT);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);
}

#[test]
fn non_arbiter_conflicting_resolutions_are_rejected_and_preserve_escrow_state() {
    let f = setup_disputed_bounty(0);
    let token_client = TokenClient::new(&f.env, &f.token);
    let outsider = Address::generate(&f.env);

    // Each non-arbiter role attempts both release and refund
    let unauthorized_callers = [
        (&f.maintainer, false),
        (&f.maintainer, true),
        (&f.contributor, true),
        (&f.contributor, false),
        (&f.admin, true),
        (&outsider, false),
    ];

    let expected_auth_err = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));

    for (caller, release) in unauthorized_callers {
        mock_resolve_auth(&f, caller, release);
        let result = f.client.try_resolve_dispute(&f.bounty_id, &release);
        assert_eq!(
            result,
            Err(Ok(expected_auth_err)),
            "non-arbiter caller must be rejected with authorization error"
        );
    }

    // Unsigned invocation is also rejected with Auth error
    f.env.mock_auths(&[]);
    let unsigned = f.client.try_resolve_dispute(&f.bounty_id, &true);
    assert_eq!(
        unsigned,
        Err(Ok(expected_auth_err)),
        "unsigned caller must be rejected with authorization error"
    );

    // Bounty remains Disputed, escrow untouched, and no BountyResolved event emitted
    assert_eq!(f.client.get_bounty(&f.bounty_id).status, BountyStatus::Disputed);
    assert_eq!(token_client.balance(&f.client.address), BOUNTY_AMOUNT);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);
    assert!(resolved_events(&f.env, &f.client.address).is_empty());

    // Legitimate arbiter can still settle the dispute cleanly afterwards
    mock_resolve_auth(&f, &f.arbiter, true);
    f.client.resolve_dispute(&f.bounty_id, &true);
    assert_eq!(f.client.get_bounty(&f.bounty_id).status, BountyStatus::Released);
    assert_eq!(token_client.balance(&f.contributor), BOUNTY_AMOUNT);
    assert_eq!(token_client.balance(&f.client.address), 0);
}

#[test]
fn non_arbiter_conflicting_resolution_after_settlement_is_rejected() {
    let f = setup_disputed_bounty(0);
    let token_client = TokenClient::new(&f.env, &f.token);

    // Arbiter settles in favor of contributor
    mock_resolve_auth(&f, &f.arbiter, true);
    f.client.resolve_dispute(&f.bounty_id, &true);

    // Maintainer attempts a conflicting refund after settlement
    mock_resolve_auth(&f, &f.maintainer, false);
    let result = f.client.try_resolve_dispute(&f.bounty_id, &false);
    let expected_auth_err = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
    assert_eq!(
        result,
        Err(Ok(expected_auth_err)),
        "non-arbiter post-settlement resolution must be rejected with authorization error"
    );

    // Final decision and balances remain intact
    assert_eq!(f.client.get_bounty(&f.bounty_id).status, BountyStatus::Released);
    assert_eq!(token_client.balance(&f.contributor), BOUNTY_AMOUNT);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.client.address), 0);
    assert_eq!(resolved_events(&f.env, &f.client.address).len(), 1);
}
