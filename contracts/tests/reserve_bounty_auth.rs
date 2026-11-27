//! Regression and security coverage for authority on contract reservation (`reserve_bounty` and `reassign_bounty`, SBB-2026-413 / #1882).
//!
//! Asserts that:
//! - `reserve_bounty` succeeds when signed by the legitimate contributor (including at the exact expiry boundary
//!   `ledger.timestamp() == deadline`) and is rejected with an authorization error when signed by any other role
//!   (maintainer, arbiter, admin, outsider) or when the signature is missing.
//! - A second contributor racing to reserve an already-reserved bounty fails with `BountyAlreadyReserved` (#3)
//!   and cannot redirect subsequent submission or payout away from the first contributor.
//! - Strictly past the expiry boundary (`deadline + 1`), `reserve_bounty` fails with `BountyExpired` (#22).
//! - `reassign_bounty` enforces `bounty.maintainer` authority at the exact expiry boundary and rejects signed
//!   contributors, the arbiter, outsiders, and post-expiry calls without mutating state or moving escrow funds.

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Events, Ledger as _, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, FromVal, IntoVal, String,
};
use stellar_bounty_board::{
    BountyReassigned, BountyReserved, BountyStatus, ContractError, StellarBountyBoardContract,
    StellarBountyBoardContractClient,
};

#[contract]
struct PermissiveToken;

#[contractimpl]
impl PermissiveToken {
    pub fn transfer(env: Env, _from: Address, _to: Address, _amount: i128) {
        let key = symbol_short!("COUNT");
        let count = env.storage().instance().get::<_, u32>(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(count + 1));
    }

    pub fn transfer_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&symbol_short!("COUNT"))
            .unwrap_or(0)
    }
}

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
    admin: Address,
    token: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);
    let admin = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    client.initialize(&admin, &fee_recipient, &arbiter, &600);

    let token = env.register(PermissiveToken, ());

    Fixture {
        env,
        client,
        maintainer,
        contributor,
        arbiter,
        admin,
        token,
    }
}

fn create_open_bounty(f: &Fixture) -> u64 {
    let amount = 500i128;
    let repo = String::from_str(&f.env, "repo");
    let title = String::from_str(&f.env, "title");
    let deadline = f.env.ledger().timestamp() + 1_000;
    let create = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "create_bounty",
        args: (
            &f.maintainer,
            &f.token,
            &amount,
            &repo,
            &1u32,
            &title,
            &deadline,
            &0u32,
            &None::<u64>,
        )
            .into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &create,
    }]);
    f.client.create_bounty(
        &f.maintainer,
        &f.token,
        &amount,
        &repo,
        &1,
        &title,
        &deadline,
        &0,
        &None,
    )
}

#[test]
fn only_the_contributor_can_reserve_a_bounty() {
    // ── 1. Correct caller path ────────────────────────────────────────────────
    let f = setup();
    let bounty_id = create_open_bounty(&f);

    let reserve_invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "reserve_bounty",
        args: (&bounty_id, &f.contributor).into_val(&f.env),
        sub_invokes: &[],
    };

    f.env.mock_auths(&[MockAuth {
        address: &f.contributor,
        invoke: &reserve_invoke,
    }]);

    f.client.reserve_bounty(&bounty_id, &f.contributor);

    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);
    assert_eq!(bounty.contributor, Some(f.contributor.clone()));

    // ── 2. Wrong signer cases (each incorrect role) ───────────────────────────
    // When someone else (maintainer, arbiter, admin, outsider) signs the
    // invocation on behalf of the contributor argument, the contract's
    // `contributor.require_auth()` must fail with an auth error.
    for role in ["maintainer", "arbiter", "admin", "outsider"] {
        let f = setup();
        let bounty_id = create_open_bounty(&f);

        let signer = match role {
            "maintainer" => f.maintainer.clone(),
            "arbiter" => f.arbiter.clone(),
            "admin" => f.admin.clone(),
            _ => Address::generate(&f.env),
        };

        let invoke = MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "reserve_bounty",
            args: (&bounty_id, &f.contributor).into_val(&f.env),
            sub_invokes: &[],
        };

        f.env.mock_auths(&[MockAuth {
            address: &signer,
            invoke: &invoke,
        }]);

        let result = f.client.try_reserve_bounty(&bounty_id, &f.contributor);
        let expected = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
        assert_eq!(
            result,
            Err(Ok(expected)),
            "{role} must not be allowed to reserve bounty on behalf of contributor"
        );

        // State must remain Open and unreserved
        let bounty = f.client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Open);
        assert_eq!(bounty.contributor, None);
    }

    // ── 3. Missing signer case (no auth provided) ─────────────────────────────
    {
        let f = setup();
        let bounty_id = create_open_bounty(&f);

        f.env.mock_auths(&[]);

        let result = f.client.try_reserve_bounty(&bounty_id, &f.contributor);
        let expected = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
        assert_eq!(
            result,
            Err(Ok(expected)),
            "unauthenticated call must not reserve bounty"
        );

        let bounty = f.client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Open);
        assert_eq!(bounty.contributor, None);
    }
}

struct SacFixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    maintainer: Address,
    contributor: Address,
    second_contributor: Address,
    arbiter: Address,
    outsider: Address,
    token: Address,
}

fn setup_funded_sac_bounty(amount: i128, deadline_offset: u64) -> (SacFixture, u64, u64) {
    let env = Env::default();
    env.mock_all_auths();

    let initial_ts: u64 = 20_000;
    env.ledger().set_timestamp(initial_ts);
    let deadline = initial_ts + deadline_offset;

    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let second_contributor = Address::generate(&env);
    let outsider = Address::generate(&env);

    client.initialize(&admin, &fee_recipient, &arbiter, &600);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    StellarAssetClient::new(&env, &token).mint(&maintainer, &amount);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token,
        &amount,
        &String::from_str(&env, "ritik4ever/stellar-bounty-board"),
        &1882u32,
        &String::from_str(&env, "Enforce reservation authority"),
        &deadline,
        &0u32,
        &None,
    );

    // Drop blanket auths so all subsequent reservation/reassignment/submission
    // checks strictly enforce Soroban caller authorization.
    env.mock_auths(&[]);

    (
        SacFixture {
            env,
            client,
            maintainer,
            contributor,
            second_contributor,
            arbiter,
            outsider,
            token,
        },
        bounty_id,
        deadline,
    )
}

fn mock_reserve_auth(
    env: &Env,
    contract: &Address,
    signer: &Address,
    bounty_id: u64,
    contributor_arg: &Address,
) {
    let invoke = MockAuthInvoke {
        contract,
        fn_name: "reserve_bounty",
        args: (&bounty_id, contributor_arg).into_val(env),
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &invoke,
    }]);
}

fn mock_reassign_auth(
    env: &Env,
    contract: &Address,
    signer: &Address,
    bounty_id: u64,
    maintainer_arg: &Address,
    new_contributor: &Address,
) {
    let invoke = MockAuthInvoke {
        contract,
        fn_name: "reassign_bounty",
        args: (&bounty_id, maintainer_arg, new_contributor).into_val(env),
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &invoke,
    }]);
}

fn mock_submit_auth(
    env: &Env,
    contract: &Address,
    signer: &Address,
    bounty_id: u64,
    contributor_arg: &Address,
) {
    let invoke = MockAuthInvoke {
        contract,
        fn_name: "submit_bounty",
        args: (&bounty_id, contributor_arg).into_val(env),
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &invoke,
    }]);
}

#[test]
fn reservation_at_exact_expiry_ledger_enforces_role_authority_and_racing_contributor() {
    let exact_amount: i128 = 1_234_567;
    let (f, bounty_id, deadline) = setup_funded_sac_bounty(exact_amount, 1_500);
    let token_client = TokenClient::new(&f.env, &f.token);

    // Move to the exact expiry boundary: now == deadline
    f.env.ledger().set_timestamp(deadline);

    // 1. Signed maintainer and signed arbiter cannot reserve on behalf of contributor
    let auth_err = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
    for signer in [&f.maintainer, &f.arbiter, &f.outsider] {
        mock_reserve_auth(
            &f.env,
            &f.client.address,
            signer,
            bounty_id,
            &f.contributor,
        );
        let res = f.client.try_reserve_bounty(&bounty_id, &f.contributor);
        assert_eq!(res, Err(Ok(auth_err)));

        let bounty = f.client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Open);
        assert_eq!(bounty.contributor, None);
    }
    assert_eq!(token_client.balance(&f.client.address), exact_amount);

    // 2. Signed contributor succeeds at exact expiry boundary (now == deadline)
    mock_reserve_auth(
        &f.env,
        &f.client.address,
        &f.contributor,
        bounty_id,
        &f.contributor,
    );
    f.client.reserve_bounty(&bounty_id, &f.contributor);

    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);
    assert_eq!(bounty.contributor, Some(f.contributor.clone()));

    let events = f.env.events().all().filter_by_contract(&f.client.address);
    let last_event = events.events().last().unwrap();
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &last_event.body;
    assert_eq!(
        soroban_sdk::Symbol::from_val(&f.env, &body.topics[0]),
        symbol_short!("Bounty")
    );
    assert_eq!(
        soroban_sdk::Symbol::from_val(&f.env, &body.topics[1]),
        symbol_short!("Reserv")
    );
    assert_eq!(
        BountyReserved::from_val(&f.env, &body.data),
        BountyReserved {
            bounty_id,
            contributor: f.contributor.clone(),
        }
    );

    // 3. Second contributor racing to reserve at exact expiry boundary is rejected
    mock_reserve_auth(
        &f.env,
        &f.client.address,
        &f.second_contributor,
        bounty_id,
        &f.second_contributor,
    );
    let race_res = f
        .client
        .try_reserve_bounty(&bounty_id, &f.second_contributor);
    assert_eq!(
        race_res,
        Err(Ok(Error::from_contract_error(
            ContractError::BountyAlreadyReserved as u32
        )))
    );

    // Second contributor also cannot hijack submission at the boundary
    mock_submit_auth(
        &f.env,
        &f.client.address,
        &f.second_contributor,
        bounty_id,
        &f.second_contributor,
    );
    let hijack_submit = f
        .client
        .try_submit_bounty(&bounty_id, &f.second_contributor);
    assert_eq!(
        hijack_submit,
        Err(Ok(Error::from_contract_error(
            ContractError::ContributorMismatch as u32
        )))
    );

    // First contributor's reservation and escrow balance remain intact
    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);
    assert_eq!(bounty.contributor, Some(f.contributor.clone()));
    assert_eq!(token_client.balance(&f.client.address), exact_amount);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.second_contributor), 0);
    assert_eq!(token_client.balance(&f.maintainer), 0);
    assert_eq!(token_client.balance(&f.arbiter), 0);
}

#[test]
fn reservation_one_second_past_expiry_rejected_for_all_roles_and_preserves_escrow() {
    let exact_amount: i128 = 987_654;
    let (f, bounty_id, deadline) = setup_funded_sac_bounty(exact_amount, 900);
    let token_client = TokenClient::new(&f.env, &f.token);

    // Move strictly past expiry boundary: now == deadline + 1
    f.env.ledger().set_timestamp(deadline + 1);

    // Signed maintainer or arbiter signing on behalf of contributor still fails auth
    let auth_err = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
    for signer in [&f.maintainer, &f.arbiter] {
        mock_reserve_auth(
            &f.env,
            &f.client.address,
            signer,
            bounty_id,
            &f.contributor,
        );
        assert_eq!(
            f.client.try_reserve_bounty(&bounty_id, &f.contributor),
            Err(Ok(auth_err))
        );
    }

    // Signed contributor is rejected with BountyExpired (#22)
    mock_reserve_auth(
        &f.env,
        &f.client.address,
        &f.contributor,
        bounty_id,
        &f.contributor,
    );
    let expired_res = f.client.try_reserve_bounty(&bounty_id, &f.contributor);
    assert_eq!(
        expired_res,
        Err(Ok(Error::from_contract_error(
            ContractError::BountyExpired as u32
        )))
    );

    // Bounty was never reserved and escrow balance is untouched
    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Expired);
    assert_eq!(bounty.contributor, None);
    assert_eq!(token_client.balance(&f.client.address), exact_amount);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.maintainer), 0);
}

#[test]
fn reassignment_at_exact_expiry_ledger_enforces_maintainer_authority_and_rejects_past_expiry() {
    let exact_amount: i128 = 777_333;
    let (f, bounty_id, deadline) = setup_funded_sac_bounty(exact_amount, 1_200);
    let token_client = TokenClient::new(&f.env, &f.token);

    // Reserve as contributor before deadline
    mock_reserve_auth(
        &f.env,
        &f.client.address,
        &f.contributor,
        bounty_id,
        &f.contributor,
    );
    f.client.reserve_bounty(&bounty_id, &f.contributor);

    // Advance to exact expiry boundary: now == deadline
    f.env.ledger().set_timestamp(deadline);

    // 1. Signed contributor, second contributor, arbiter, and outsider cannot reassign
    let auth_err = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
    for caller in [
        &f.contributor,
        &f.second_contributor,
        &f.arbiter,
        &f.outsider,
    ] {
        // Impersonating maintainer argument fails Soroban auth
        mock_reassign_auth(
            &f.env,
            &f.client.address,
            caller,
            bounty_id,
            &f.maintainer,
            &f.second_contributor,
        );
        assert_eq!(
            f.client
                .try_reassign_bounty(&bounty_id, &f.maintainer, &f.second_contributor),
            Err(Ok(auth_err))
        );

        // Passing own address as maintainer fails MaintainerMismatch (#25)
        mock_reassign_auth(
            &f.env,
            &f.client.address,
            caller,
            bounty_id,
            caller,
            &f.second_contributor,
        );
        assert_eq!(
            f.client
                .try_reassign_bounty(&bounty_id, caller, &f.second_contributor),
            Err(Ok(Error::from_contract_error(
                ContractError::MaintainerMismatch as u32
            )))
        );
    }
    assert_eq!(
        f.client.get_bounty(&bounty_id).contributor,
        Some(f.contributor.clone())
    );

    // 2. Signed maintainer succeeds at exact expiry boundary (now == deadline)
    mock_reassign_auth(
        &f.env,
        &f.client.address,
        &f.maintainer,
        bounty_id,
        &f.maintainer,
        &f.second_contributor,
    );
    f.client
        .reassign_bounty(&bounty_id, &f.maintainer, &f.second_contributor);

    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);
    assert_eq!(bounty.contributor, Some(f.second_contributor.clone()));

    let events = f.env.events().all().filter_by_contract(&f.client.address);
    let last_event = events.events().last().unwrap();
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &last_event.body;
    assert_eq!(
        soroban_sdk::Symbol::from_val(&f.env, &body.topics[0]),
        symbol_short!("Bounty")
    );
    assert_eq!(
        soroban_sdk::Symbol::from_val(&f.env, &body.topics[1]),
        symbol_short!("Reassign")
    );
    assert_eq!(
        BountyReassigned::from_val(&f.env, &body.data),
        BountyReassigned {
            bounty_id,
            old_contributor: f.contributor.clone(),
            new_contributor: f.second_contributor.clone(),
        }
    );

    // 3. Past expiry (deadline + 1), even signed maintainer cannot reassign
    f.env.ledger().set_timestamp(deadline + 1);
    mock_reassign_auth(
        &f.env,
        &f.client.address,
        &f.maintainer,
        bounty_id,
        &f.maintainer,
        &f.contributor,
    );
    let post_expiry = f
        .client
        .try_reassign_bounty(&bounty_id, &f.maintainer, &f.contributor);
    assert_eq!(
        post_expiry,
        Err(Ok(Error::from_contract_error(
            ContractError::BountyMustBeReserved as u32
        )))
    );

    // Assignment and escrow balance remain completely preserved
    assert_eq!(
        f.client.get_bounty(&bounty_id).contributor,
        Some(f.second_contributor.clone())
    );
    assert_eq!(token_client.balance(&f.client.address), exact_amount);
    assert_eq!(token_client.balance(&f.contributor), 0);
    assert_eq!(token_client.balance(&f.second_contributor), 0);
    assert_eq!(token_client.balance(&f.maintainer), 0);
}
