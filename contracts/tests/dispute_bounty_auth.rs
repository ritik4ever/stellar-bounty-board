//! Regression coverage for contributor authorization on `dispute_bounty`.
//!
//! Asserts that `dispute_bounty` succeeds when signed by the legitimate contributor
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

fn create_submitted_bounty(f: &Fixture) -> u64 {
    let amount = 500i128;
    let repo = String::from_str(&f.env, "repo");
    let title = String::from_str(&f.env, "title");
    let deadline = f.env.ledger().timestamp() + 1_000;

    // 1. Create bounty as maintainer
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
    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.token,
        &amount,
        &repo,
        &1,
        &title,
        &deadline,
        &0,
        &None,
    );

    // 2. Reserve bounty as contributor
    let reserve = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "reserve_bounty",
        args: (&bounty_id, &f.contributor).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.contributor,
        invoke: &reserve,
    }]);
    f.client.reserve_bounty(&bounty_id, &f.contributor);

    // 3. Submit bounty as contributor
    let submit = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "submit_bounty",
        args: (&bounty_id, &f.contributor).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.contributor,
        invoke: &submit,
    }]);
    f.client.submit_bounty(&bounty_id, &f.contributor);

    bounty_id
}

#[test]
fn only_the_contributor_can_dispute_a_bounty() {
    // ── 1. Correct caller path ────────────────────────────────────────────────
    let f = setup();
    let bounty_id = create_submitted_bounty(&f);

    let dispute_invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "dispute_bounty",
        args: (&bounty_id, &f.arbiter).into_val(&f.env),
        sub_invokes: &[],
    };

    f.env.mock_auths(&[MockAuth {
        address: &f.contributor,
        invoke: &dispute_invoke,
    }]);

    f.client.dispute_bounty(&bounty_id, &f.arbiter);

    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Disputed);
    assert_eq!(bounty.dispute_raised_at, f.env.ledger().timestamp());
    assert_eq!(bounty.contributor, Some(f.contributor.clone()));

    // Verify BountyDisputed event was published
    let events = f.env.events().all().filter_by_contract(&f.client.address);
    let dispute_event = events.events().last().expect("dispute event should be emitted");
    let topics = dispute_event.topics();
    assert_eq!(
        topics.get(0).unwrap(),
        symbol_short!("Bounty").into_val(&f.env)
    );
    assert_eq!(
        topics.get(1).unwrap(),
        symbol_short!("Dispt").into_val(&f.env)
    );

    // ── 2. Wrong signer cases (each incorrect role) ───────────────────────────
    // When someone else (maintainer, arbiter, admin, outsider) signs the
    // invocation on behalf of the contributor, the contract's
    // `contributor.require_auth()` must fail with an auth error.
    for role in ["maintainer", "arbiter", "admin", "outsider"] {
        let f = setup();
        let bounty_id = create_submitted_bounty(&f);

        let signer = match role {
            "maintainer" => f.maintainer.clone(),
            "arbiter" => f.arbiter.clone(),
            "admin" => f.admin.clone(),
            _ => Address::generate(&f.env),
        };

        let invoke = MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "dispute_bounty",
            args: (&bounty_id, &f.arbiter).into_val(&f.env),
            sub_invokes: &[],
        };

        f.env.mock_auths(&[MockAuth {
            address: &signer,
            invoke: &invoke,
        }]);

        let result = f.client.try_dispute_bounty(&bounty_id, &f.arbiter);
        let expected = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
        assert_eq!(
            result,
            Err(Ok(expected)),
            "{role} must not be allowed to dispute bounty on behalf of contributor"
        );

        // State must remain Submitted and not disputed
        let bounty = f.client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Submitted);
        assert_eq!(bounty.dispute_raised_at, 0);

        // Assert that calling dispute_bounty directly panics for this incorrect role
        let panic_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            f.client.dispute_bounty(&bounty_id, &f.arbiter);
        }));
        assert!(
            panic_result.is_err(),
            "{role} calling dispute_bounty directly must panic with authorization error"
        );
    }

    // ── 3. Missing signer case (no auth provided) ─────────────────────────────
    {
        let f = setup();
        let bounty_id = create_submitted_bounty(&f);

        f.env.mock_auths(&[]);

        let result = f.client.try_dispute_bounty(&bounty_id, &f.arbiter);
        let expected = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
        assert_eq!(
            result,
            Err(Ok(expected)),
            "unauthenticated call must not dispute bounty"
        );

        let bounty = f.client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Submitted);
        assert_eq!(bounty.dispute_raised_at, 0);

        // Assert that calling dispute_bounty directly panics with no auth
        let panic_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            f.client.dispute_bounty(&bounty_id, &f.arbiter);
        }));
        assert!(
            panic_result.is_err(),
            "unauthenticated dispute_bounty call must panic"
        );
    }
}

#[test]
#[should_panic]
fn dispute_bounty_signed_by_maintainer_panics() {
    let f = setup();
    let bounty_id = create_submitted_bounty(&f);

    let invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "dispute_bounty",
        args: (&bounty_id, &f.arbiter).into_val(&f.env),
        sub_invokes: &[],
    };

    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &invoke,
    }]);

    f.client.dispute_bounty(&bounty_id, &f.arbiter);
}

#[test]
#[should_panic]
fn dispute_bounty_signed_by_arbiter_panics() {
    let f = setup();
    let bounty_id = create_submitted_bounty(&f);

    let invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "dispute_bounty",
        args: (&bounty_id, &f.arbiter).into_val(&f.env),
        sub_invokes: &[],
    };

    f.env.mock_auths(&[MockAuth {
        address: &f.arbiter,
        invoke: &invoke,
    }]);

    f.client.dispute_bounty(&bounty_id, &f.arbiter);
}

#[test]
#[should_panic]
fn dispute_bounty_signed_by_admin_panics() {
    let f = setup();
    let bounty_id = create_submitted_bounty(&f);

    let invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "dispute_bounty",
        args: (&bounty_id, &f.arbiter).into_val(&f.env),
        sub_invokes: &[],
    };

    f.env.mock_auths(&[MockAuth {
        address: &f.admin,
        invoke: &invoke,
    }]);

    f.client.dispute_bounty(&bounty_id, &f.arbiter);
}

#[test]
#[should_panic]
fn dispute_bounty_signed_by_outsider_panics() {
    let f = setup();
    let bounty_id = create_submitted_bounty(&f);

    let outsider = Address::generate(&f.env);
    let invoke = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "dispute_bounty",
        args: (&bounty_id, &f.arbiter).into_val(&f.env),
        sub_invokes: &[],
    };

    f.env.mock_auths(&[MockAuth {
        address: &outsider,
        invoke: &invoke,
    }]);

    f.client.dispute_bounty(&bounty_id, &f.arbiter);
}

#[test]
#[should_panic]
fn dispute_bounty_unauthenticated_panics() {
    let f = setup();
    let bounty_id = create_submitted_bounty(&f);

    f.env.mock_auths(&[]);

    f.client.dispute_bounty(&bounty_id, &f.arbiter);
}
