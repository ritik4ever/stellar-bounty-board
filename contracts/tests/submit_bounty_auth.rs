//! Focused integration tests for `submit_bounty` deadline boundary and role authorization.
//!
//! Covers:
//! - Submitting a reserved bounty exactly at its deadline (`now == deadline`) by the
//!   signed reserved contributor, and verifying signed maintainer release and signed
//!   arbiter dispute/resolution flows afterward.
//! - Rejecting submissions after the deadline (`now == deadline + 1`) with `BountyExpired`
//!   while preserving escrow for maintainer refund.
//! - Rejecting any caller other than the reserved contributor (signed maintainer, arbiter,
//!   admin, or outsider passing their own address -> `ContributorMismatch`, or attempting
//!   to impersonate the reserved contributor / omitting auth -> `InvalidAction`), ensuring
//!   unauthorized callers cannot redirect funds or change decisions.

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger as _, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal, String,
};
use stellar_bounty_board::{
    BountyStatus, ContractError, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

const DISPUTE_WINDOW: u64 = 600;
const INITIAL_TIMESTAMP: u64 = 10_000;
const DEADLINE: u64 = 11_000;
const BOUNTY_AMOUNT: i128 = 1_000;
const FEE_BPS: u32 = 500; // 5% -> 50 fee, 950 net payout

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    admin: Address,
    fee_recipient: Address,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
    outsider: Address,
    token: Address,
    bounty_id: u64,
}

fn setup_reserved_bounty() -> Fixture {
    let env = Env::default();
    env.ledger().set_timestamp(INITIAL_TIMESTAMP);

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let outsider = Address::generate(&env);

    client.initialize(&admin, &fee_recipient, &arbiter, &DISPUTE_WINDOW);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    // Mint isolated test tokens (no live funds) to the maintainer.
    let sac = StellarAssetClient::new(&env, &token);
    let mint_invoke = MockAuthInvoke {
        contract: &token,
        fn_name: "mint",
        args: (&maintainer, &BOUNTY_AMOUNT).into_val(&env),
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &token_admin,
        invoke: &mint_invoke,
    }]);
    sac.mint(&maintainer, &BOUNTY_AMOUNT);

    // Signed maintainer creates and funds the bounty.
    let repo = String::from_str(&env, "repo");
    let title = String::from_str(&env, "submit-auth-test");
    let transfer_sub = MockAuthInvoke {
        contract: &token,
        fn_name: "transfer",
        args: (&maintainer, &client.address, &BOUNTY_AMOUNT).into_val(&env),
        sub_invokes: &[],
    };
    let create_invoke = MockAuthInvoke {
        contract: &client.address,
        fn_name: "create_bounty",
        args: (
            &maintainer,
            &token,
            &BOUNTY_AMOUNT,
            &repo,
            &1u32,
            &title,
            &DEADLINE,
            &FEE_BPS,
            &None::<u64>,
        )
            .into_val(&env),
        sub_invokes: &[transfer_sub],
    };
    env.mock_auths(&[MockAuth {
        address: &maintainer,
        invoke: &create_invoke,
    }]);
    let bounty_id = client.create_bounty(
        &maintainer,
        &token,
        &BOUNTY_AMOUNT,
        &repo,
        &1,
        &title,
        &DEADLINE,
        &FEE_BPS,
        &None,
    );

    // Signed contributor reserves the bounty.
    let reserve_invoke = MockAuthInvoke {
        contract: &client.address,
        fn_name: "reserve_bounty",
        args: (&bounty_id, &contributor).into_val(&env),
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &contributor,
        invoke: &reserve_invoke,
    }]);
    client.reserve_bounty(&bounty_id, &contributor);

    Fixture {
        env,
        client,
        admin,
        fee_recipient,
        maintainer,
        contributor,
        arbiter,
        outsider,
        token,
        bounty_id,
    }
}

fn mock_submit_auth(f: &Fixture, signer: &Address, arg_contributor: &Address) {
    let invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "submit_bounty",
        args: (&f.bounty_id, arg_contributor).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &invoke,
    }]);
}

#[test]
fn reserved_bounty_submitted_at_deadline_succeeds_and_maintainer_can_release() {
    let f = setup_reserved_bounty();
    let token_client = TokenClient::new(&f.env, &f.token);

    // Advance ledger timestamp to exactly the deadline (now == deadline).
    f.env.ledger().set_timestamp(DEADLINE);

    // Signed reserved contributor submits at the deadline.
    mock_submit_auth(&f, &f.contributor, &f.contributor);
    f.client.submit_bounty(&f.bounty_id, &f.contributor);

    // Submission emits the (Bounty, Submit) event and does not move escrow funds.
    assert_eq!(f.env.events().all().events().len(), 1);

    let bounty = f.client.get_bounty(&f.bounty_id);
    assert_eq!(bounty.status, BountyStatus::Submitted);
    assert_eq!(bounty.contributor, Some(f.contributor.clone()));

    assert_eq!(token_client.balance(&f.client.address), BOUNTY_AMOUNT);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.fee_recipient), 0);

    // Signed maintainer releases payout to the reserved contributor.
    let release_invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "release_bounty",
        args: (&f.bounty_id, &f.maintainer).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &release_invoke,
    }]);
    f.client.release_bounty(&f.bounty_id, &f.maintainer);

    let released = f.client.get_bounty(&f.bounty_id);
    assert_eq!(released.status, BountyStatus::Released);
    assert_eq!(token_client.balance(&f.client.address), 0);
    assert_eq!(token_client.balance(&f.contributor), 950);
    assert_eq!(token_client.balance(&f.fee_recipient), 50);
    assert_eq!(token_client.balance(&f.maintainer), 0);
}

#[test]
fn reserved_bounty_submitted_at_deadline_can_be_disputed_and_resolved_by_arbiter() {
    let f = setup_reserved_bounty();
    let token_client = TokenClient::new(&f.env, &f.token);

    // Advance to exactly the deadline and submit as the signed reserved contributor.
    f.env.ledger().set_timestamp(DEADLINE);
    mock_submit_auth(&f, &f.contributor, &f.contributor);
    f.client.submit_bounty(&f.bounty_id, &f.contributor);

    // Signed contributor opens a dispute naming the registered arbiter.
    let dispute_invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "dispute_bounty",
        args: (&f.bounty_id, &f.arbiter).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.contributor,
        invoke: &dispute_invoke,
    }]);
    f.client.dispute_bounty(&f.bounty_id, &f.arbiter);
    assert_eq!(
        f.client.get_bounty(&f.bounty_id).status,
        BountyStatus::Disputed
    );

    // Wait for the dispute window to elapse, then signed arbiter resolves in favor of contributor.
    f.env.ledger().set_timestamp(DEADLINE + DISPUTE_WINDOW);
    let resolve_invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "resolve_dispute",
        args: (&f.bounty_id, &true).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.arbiter,
        invoke: &resolve_invoke,
    }]);
    f.client.resolve_dispute(&f.bounty_id, &true);

    let resolved = f.client.get_bounty(&f.bounty_id);
    assert_eq!(resolved.status, BountyStatus::Released);
    assert_eq!(token_client.balance(&f.client.address), 0);
    assert_eq!(token_client.balance(&f.contributor), 950);
    assert_eq!(token_client.balance(&f.fee_recipient), 50);
}

#[test]
fn non_reserved_callers_cannot_submit_with_own_signature_or_redirect_funds() {
    let f = setup_reserved_bounty();
    let token_client = TokenClient::new(&f.env, &f.token);

    // Check at the exact deadline so the only rejection reason is caller mismatch.
    f.env.ledger().set_timestamp(DEADLINE);

    let expected_mismatch = Error::from_contract_error(ContractError::ContributorMismatch as u32);

    for (role, caller) in [
        ("maintainer", f.maintainer.clone()),
        ("arbiter", f.arbiter.clone()),
        ("admin", f.admin.clone()),
        ("outsider", f.outsider.clone()),
    ] {
        mock_submit_auth(&f, &caller, &caller);
        let result = f.client.try_submit_bounty(&f.bounty_id, &caller);
        assert_eq!(
            result,
            Err(Ok(expected_mismatch)),
            "signed {role} must be rejected with ContributorMismatch"
        );

        // Reservation, assigned contributor, and escrow must remain untouched.
        let bounty = f.client.get_bounty(&f.bounty_id);
        assert_eq!(bounty.status, BountyStatus::Reserved);
        assert_eq!(bounty.contributor, Some(f.contributor.clone()));
        assert_eq!(token_client.balance(&f.client.address), BOUNTY_AMOUNT);
        assert_eq!(token_client.balance(&caller), 0);
    }

    // Legitimate reserved contributor can still submit at the deadline afterward.
    mock_submit_auth(&f, &f.contributor, &f.contributor);
    f.client.submit_bounty(&f.bounty_id, &f.contributor);
    assert_eq!(
        f.client.get_bounty(&f.bounty_id).status,
        BountyStatus::Submitted
    );
}

#[test]
fn wrong_signer_or_missing_auth_cannot_submit_on_behalf_of_reserved_contributor() {
    let f = setup_reserved_bounty();
    let token_client = TokenClient::new(&f.env, &f.token);
    let expected_auth_err = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));

    f.env.ledger().set_timestamp(DEADLINE);

    for (role, signer) in [
        ("maintainer", f.maintainer.clone()),
        ("arbiter", f.arbiter.clone()),
        ("admin", f.admin.clone()),
        ("outsider", f.outsider.clone()),
    ] {
        mock_submit_auth(&f, &signer, &f.contributor);
        let result = f.client.try_submit_bounty(&f.bounty_id, &f.contributor);
        assert_eq!(
            result,
            Err(Ok(expected_auth_err)),
            "{role} signing for reserved contributor must fail require_auth"
        );

        let bounty = f.client.get_bounty(&f.bounty_id);
        assert_eq!(bounty.status, BountyStatus::Reserved);
        assert_eq!(bounty.contributor, Some(f.contributor.clone()));
        assert_eq!(token_client.balance(&f.client.address), BOUNTY_AMOUNT);
    }

    // Missing auth must also be rejected.
    f.env.mock_auths(&[]);
    let no_auth_result = f.client.try_submit_bounty(&f.bounty_id, &f.contributor);
    assert_eq!(
        no_auth_result,
        Err(Ok(expected_auth_err)),
        "unauthenticated submit_bounty must be rejected"
    );

    let bounty = f.client.get_bounty(&f.bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);
    assert_eq!(bounty.contributor, Some(f.contributor.clone()));
    assert_eq!(token_client.balance(&f.client.address), BOUNTY_AMOUNT);
}

#[test]
fn submit_one_second_after_deadline_fails_with_bounty_expired() {
    let f = setup_reserved_bounty();
    let token_client = TokenClient::new(&f.env, &f.token);

    // Advance one second past the deadline (now > deadline).
    f.env.ledger().set_timestamp(DEADLINE + 1);

    mock_submit_auth(&f, &f.contributor, &f.contributor);
    let result = f.client.try_submit_bounty(&f.bounty_id, &f.contributor);
    assert_eq!(
        result,
        Err(Ok(Error::from_contract_error(
            ContractError::BountyExpired as u32
        ))),
        "submission after deadline must fail with BountyExpired"
    );

    // Escrow remains intact and the bounty is observed as Expired (not Submitted).
    let bounty = f.client.get_bounty(&f.bounty_id);
    assert_eq!(bounty.status, BountyStatus::Expired);
    assert_eq!(bounty.contributor, Some(f.contributor.clone()));
    assert_eq!(token_client.balance(&f.client.address), BOUNTY_AMOUNT);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.maintainer), 0);
}
