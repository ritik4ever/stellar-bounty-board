//! Regression coverage for contributor authorization on `reserve_bounty`.
//!
//! Asserts that `reserve_bounty` succeeds when signed by the legitimate contributor
//! and panics / is rejected with an authorization error when signed by any other role
//! (maintainer, arbiter, admin, outsider) or when the signature is missing.

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal, String,
};
use stellar_bounty_board::{
    BountyStatus, StellarBountyBoardContract, StellarBountyBoardContractClient,
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
