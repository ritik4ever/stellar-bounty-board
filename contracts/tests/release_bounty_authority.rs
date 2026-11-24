//! Regression coverage for payout authority on submitted bounties.

use soroban_sdk::{
    contract, contractimpl,
    symbol_short,
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
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}

    pub fn balance(env: Env, _address: Address) -> i128 {
        env.storage().instance().get(&symbol_short!("BAL")).unwrap_or(0)
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
    client.initialize(&admin, &fee_recipient, &arbiter, &60);
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
    let id = f.client.create_bounty(
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

    let reserve = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "reserve_bounty",
        args: (&id, &f.contributor).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.contributor,
        invoke: &reserve,
    }]);
    f.client.reserve_bounty(&id, &f.contributor);

    let submit = MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "submit_bounty",
        args: (&id, &f.contributor).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.contributor,
        invoke: &submit,
    }]);
    f.client.submit_bounty(&id, &f.contributor);
    id
}

fn release_invoke(f: &Fixture, id: u64) -> MockAuthInvoke<'_> {
    MockAuthInvoke {
        contract: &f.client.address,
        fn_name: "release_bounty",
        args: (&id, &f.maintainer).into_val(&f.env),
        sub_invokes: &[],
    }
}

#[test]
fn submitted_bounty_release_requires_the_registered_maintainer() {
    let f = setup();
    let id = create_submitted_bounty(&f);
    f.env.ledger().set_timestamp(f.env.ledger().timestamp() + 60);

    for role in ["contributor", "arbiter", "admin", "outsider"] {
        let signer = match role {
            "contributor" => f.contributor.clone(),
            "arbiter" => f.arbiter.clone(),
            "admin" => f.admin.clone(),
            _ => Address::generate(&f.env),
        };
        let invoke = release_invoke(&f, id);
        f.env.mock_auths(&[MockAuth {
            address: &signer,
            invoke: &invoke,
        }]);

        let result = f.client.try_release_bounty(&id, &f.maintainer);
        let expected = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
        assert_eq!(
            result,
            Err(Ok(expected)),
            "{role} must not authorize the maintainer's payout"
        );
        assert_eq!(f.client.get_bounty(&id).status, BountyStatus::Submitted);
    }

    let success_invoke = release_invoke(&f, id);
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &success_invoke,
    }]);
    f.client.release_bounty(&id, &f.maintainer);
    assert_eq!(f.client.get_bounty(&id).status, BountyStatus::Released);

    let repeated_invoke = release_invoke(&f, id);
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &repeated_invoke,
    }]);
    assert!(f.client.try_release_bounty(&id, &f.maintainer).is_err());
    assert_eq!(f.client.get_bounty(&id).status, BountyStatus::Released);
}
