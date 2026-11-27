//! Regression coverage for the maintainer authorization on `create_bounty`.
//! Kept as an integration test because the pre-existing `src/test.rs` on main
//! does not currently compile with the pinned Soroban SDK.

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal, String,
};
use stellar_bounty_board::{
    BountyStatus, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

// The token deliberately does not authenticate `from`. Otherwise its own
// transfer check could hide a missing require_auth in create_bounty.
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

#[test]
fn only_the_maintainer_can_create_a_bounty() {
    let f = setup();
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
    assert_eq!(id, 1);
    assert_eq!(f.client.get_bounty(&id).status, BountyStatus::Open);
    assert_eq!(
        PermissiveTokenClient::new(&f.env, &f.token).transfer_count(),
        1
    );

    // Each role signs the exact requested invocation, but none is the
    // maintainer named in its arguments. A blanket mock would miss this bug.
    for role in ["contributor", "arbiter", "admin", "outsider"] {
        let f = setup();
        let signer = match role {
            "contributor" => f.contributor.clone(),
            "arbiter" => f.arbiter.clone(),
            "admin" => f.admin.clone(),
            _ => Address::generate(&f.env),
        };
        let repo = String::from_str(&f.env, "repo");
        let title = String::from_str(&f.env, "title");
        let deadline = f.env.ledger().timestamp() + 1_000;
        let invoke = MockAuthInvoke {
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
            address: &signer,
            invoke: &invoke,
        }]);
        let result = f.client.try_create_bounty(
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
        let expected = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
        assert_eq!(
            result,
            Err(Ok(expected)),
            "{role} must not fund or create the maintainer's bounty"
        );
        assert_eq!(
            PermissiveTokenClient::new(&f.env, &f.token).transfer_count(),
            0
        );
        assert!(f.client.try_get_bounty(&1).is_err());
    }
}
