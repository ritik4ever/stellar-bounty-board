//! Property-based checks for the numeric input accepted by `submit_bounty`.
//!
//! `submit_bounty` accepts a `u64` bounty ID (it does not accept amounts or
//! deadlines). Generated and boundary IDs must either produce the documented
//! not-found error or leave a real reserved bounty unchanged. The successful
//! transition and the documented invalid-state error are checked as well.

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, Env, String,
};
use stellar_bounty_board::{
    BountyStatus, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

const DISPUTE_WINDOW: u64 = 600;
const RESERVED_BOUNTY_ID: u64 = 1;

struct FuzzFixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    maintainer: Address,
    contributor: Address,
    token: Address,
}

fn setup_fuzz_fixture() -> FuzzFixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    client.initialize(&admin, &treasury, &arbiter, &DISPUTE_WINDOW);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    StellarAssetClient::new(&env, &token).mint(&maintainer, &1_000);
    env.ledger().set_timestamp(10_000);
    let bounty_id = client.create_bounty(
        &maintainer,
        &token,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &11_000,
        &0,
        &None,
    );
    assert_eq!(bounty_id, RESERVED_BOUNTY_ID);
    client.reserve_bounty(&bounty_id, &contributor);

    FuzzFixture {
        env,
        client,
        maintainer,
        contributor,
        token,
    }
}

fn panic_message(payload: &(dyn core::any::Any + Send)) -> &str {
    if let Some(message) = payload.downcast_ref::<&str>() {
        message
    } else if let Some(message) = payload.downcast_ref::<std::string::String>() {
        message.as_str()
    } else {
        ""
    }
}

fn assert_documented_panic(expected: &str, call: impl FnOnce()) {
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(call));
    let payload = outcome.expect_err("expected submit_bounty to reject this input");
    let message = panic_message(payload.as_ref());
    assert!(
        message.contains(expected),
        "expected documented {expected} error, got panic: {message}"
    );
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 128,
        .. ProptestConfig::default()
    })]

    #[test]
    fn fuzz_submit_bounty_arbitrary_u64_ids(ids in prop::collection::vec(any::<u64>(), 1..65)) {
        let fix = setup_fuzz_fixture();

        for id in ids {
            if id == RESERVED_BOUNTY_ID {
                continue;
            }

            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                fix.client.submit_bounty(&id, &fix.contributor);
            }));
            prop_assert!(outcome.is_err(), "unknown bounty ID {id} unexpectedly succeeded");
            let message = panic_message(outcome.unwrap_err().as_ref()).to_string();
            prop_assert!(
                message.contains("Error(Contract, #2)"),
                "unknown bounty ID {id} produced an undocumented error: {message}"
            );

            let bounty = fix.client.get_bounty(&RESERVED_BOUNTY_ID);
            prop_assert_eq!(bounty.status, BountyStatus::Reserved);
            prop_assert_eq!(bounty.contributor, Some(fix.contributor.clone()));
        }

        // The numeric probes did not corrupt the legitimate bounty. It can
        // still complete its documented Reserved -> Submitted transition.
        fix.client.submit_bounty(&RESERVED_BOUNTY_ID, &fix.contributor);
        prop_assert_eq!(fix.client.get_bounty(&RESERVED_BOUNTY_ID).status, BountyStatus::Submitted);

        let second_submit = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            fix.client.submit_bounty(&RESERVED_BOUNTY_ID, &fix.contributor);
        }));
        prop_assert!(second_submit.is_err());
        let error = panic_message(second_submit.unwrap_err().as_ref()).to_string();
        prop_assert!(
            error.contains("Error(Contract, #19)"),
            "resubmitting a submitted bounty produced an undocumented error: {error}"
        );

        // Keep these fixture resources live for the complete generated case.
        let _ = (&fix.env, &fix.maintainer, &fix.token);
    }
}

#[test]
fn fuzz_submit_bounty_u64_boundary_ids() {
    let fix = setup_fuzz_fixture();
    let boundary_ids = [
        0,
        2,
        u32::MAX as u64,
        u32::MAX as u64 + 1,
        i64::MAX as u64,
        i64::MAX as u64 + 1,
        u64::MAX - 1,
        u64::MAX,
    ];

    for id in boundary_ids {
        assert_documented_panic("Error(Contract, #2)", || {
            fix.client.submit_bounty(&id, &fix.contributor);
        });
        assert_eq!(
            fix.client.get_bounty(&RESERVED_BOUNTY_ID).status,
            BountyStatus::Reserved
        );
    }
}
