//! Property-based checks for the numeric input handled by `release_bounty`.
//!
//! `release_bounty` takes a `u64` bounty ID and indirectly depends on the
//! stored `i128` amount, the `u32` protocol fee (in basis points) and the
//! ledger timestamp. Generated and boundary values must either:
//!
//! * succeed and satisfy the payout invariants (`fee + payout == amount`,
//!   fee is `floor(amount * bps / 10_000)`, no tokens created or destroyed,
//!   `FeeStats` updated exactly once, status `Released`), or
//! * fail with one of the documented `ContractError` variants
//!   (`BountyNotFound` #2, `BountyMustBeSubmitted` #20, `MaintainerMismatch` #25),
//!   leaving every bounty untouched.
//!
//! Any other panic is treated as a failure. The case counts are small enough
//! to keep the whole file well under a few seconds in CI.

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, Env, String,
};
use stellar_bounty_board::{
    BountyStatus, StellarBountyBoardContract, StellarBountyBoardContractClient, MAX_BOUNTY_AMOUNT,
};

const DISPUTE_WINDOW: u64 = 600;
const START_TIME: u64 = 10_000;
const DEADLINE: u64 = 11_000;
const MIN_AMOUNT: i128 = 100;

const ERR_NOT_FOUND: &str = "Error(Contract, #2)";
const ERR_MUST_BE_SUBMITTED: &str = "Error(Contract, #20)";
const ERR_MAINTAINER_MISMATCH: &str = "Error(Contract, #25)";

struct FuzzFixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    maintainer: Address,
    contributor: Address,
    treasury: Address,
    contract: Address,
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
    env.ledger().set_timestamp(START_TIME);

    FuzzFixture {
        env,
        client,
        maintainer,
        contributor,
        treasury,
        contract,
        token,
    }
}

impl FuzzFixture {
    fn balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.env, &self.token).balance(who)
    }

    /// Mints `amount` to the maintainer and creates a bounty escrowing it.
    fn create(&self, amount: i128, fee_bps: u32) -> u64 {
        StellarAssetClient::new(&self.env, &self.token).mint(&self.maintainer, &amount);
        self.client.create_bounty(
            &self.maintainer,
            &self.token,
            &amount,
            &String::from_str(&self.env, "repo"),
            &1,
            &String::from_str(&self.env, "title"),
            &DEADLINE,
            &fee_bps,
            &None,
        )
    }

    fn create_submitted(&self, amount: i128, fee_bps: u32) -> u64 {
        let id = self.create(amount, fee_bps);
        self.client.reserve_bounty(&id, &self.contributor);
        self.client.submit_bounty(&id, &self.contributor);
        id
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

/// Runs `release_bounty` and returns `Ok(())` on success, or the panic message
/// on failure so callers can assert it is a documented error.
fn try_release(fix: &FuzzFixture, id: u64, caller: &Address) -> Result<(), std::string::String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        fix.client.release_bounty(&id, caller);
    }))
    .map_err(|payload| panic_message(payload.as_ref()).to_string())
}

fn assert_documented_panic(expected: &str, result: Result<(), std::string::String>) {
    let message = result.expect_err("expected release_bounty to reject this input");
    assert!(
        message.contains(expected),
        "expected documented {expected} error, got panic: {message}"
    );
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 32,
        max_shrink_iters: 64,
        .. ProptestConfig::default()
    })]

    /// Arbitrary `u64` IDs never panic outside `BountyNotFound` and never
    /// disturb the real (submitted) bounty.
    #[test]
    fn fuzz_release_bounty_arbitrary_u64_ids(ids in prop::collection::vec(any::<u64>(), 1..33)) {
        let fix = setup_fuzz_fixture();
        let real_id = fix.create_submitted(500, 0);

        for id in ids {
            if id == real_id {
                continue;
            }
            let result = try_release(&fix, id, &fix.maintainer);
            let message = result.expect_err("unknown bounty ID unexpectedly succeeded");
            prop_assert!(
                message.contains(ERR_NOT_FOUND),
                "unknown bounty ID {id} produced an undocumented error: {message}"
            );
            prop_assert_eq!(fix.client.get_bounty(&real_id).status, BountyStatus::Submitted);
        }

        fix.client.release_bounty(&real_id, &fix.maintainer);
        prop_assert_eq!(fix.client.get_bounty(&real_id).status, BountyStatus::Released);
    }

    /// For any valid amount, fee rate and release time the payout is exact,
    /// conserves tokens, and does not overflow.
    #[test]
    fn fuzz_release_bounty_amount_fee_invariants(
        amount in MIN_AMOUNT..=MAX_BOUNTY_AMOUNT,
        fee_bps in 0u32..=10_000u32,
        release_time in any::<u64>(),
    ) {
        let fix = setup_fuzz_fixture();
        let id = fix.create_submitted(amount, fee_bps);
        fix.env.ledger().set_timestamp(release_time);

        let contract_before = fix.balance(&fix.contract);
        prop_assert_eq!(contract_before, amount);

        fix.client.release_bounty(&id, &fix.maintainer);

        let expected_fee = amount * fee_bps as i128 / 10_000;
        let expected_payout = amount - expected_fee;
        prop_assert!(expected_fee >= 0 && expected_fee <= amount);
        prop_assert!(expected_payout >= 0);

        prop_assert_eq!(fix.balance(&fix.contributor), expected_payout);
        prop_assert_eq!(fix.balance(&fix.treasury), expected_fee);
        prop_assert_eq!(fix.balance(&fix.contract), 0);
        prop_assert_eq!(fix.balance(&fix.maintainer), 0);

        let stats = fix.client.get_fee_stats();
        prop_assert_eq!(stats.total_collected, expected_fee);
        prop_assert_eq!(stats.bounty_count, 1);

        let bounty = fix.client.get_bounty(&id);
        prop_assert_eq!(bounty.status, BountyStatus::Released);
        prop_assert_eq!(bounty.amount, amount);
        prop_assert_eq!(bounty.protocol_fee_bps, fee_bps);

        // A second release is rejected and moves no funds.
        let second = try_release(&fix, id, &fix.maintainer);
        let message = second.expect_err("double release unexpectedly succeeded");
        prop_assert!(
            message.contains(ERR_MUST_BE_SUBMITTED),
            "double release produced an undocumented error: {message}"
        );
        prop_assert_eq!(fix.balance(&fix.contributor), expected_payout);
        prop_assert_eq!(fix.balance(&fix.treasury), expected_fee);
        prop_assert_eq!(fix.client.get_fee_stats().bounty_count, 1);
    }

    /// Any caller other than the maintainer is rejected with
    /// `MaintainerMismatch` and nothing changes.
    #[test]
    fn fuzz_release_bounty_wrong_caller_rejected(
        amount in MIN_AMOUNT..=MAX_BOUNTY_AMOUNT,
        fee_bps in 0u32..=10_000u32,
    ) {
        let fix = setup_fuzz_fixture();
        let id = fix.create_submitted(amount, fee_bps);
        let stranger = Address::generate(&fix.env);

        for caller in [&stranger, &fix.contributor] {
            let message = try_release(&fix, id, caller)
                .expect_err("non-maintainer release unexpectedly succeeded");
            prop_assert!(
                message.contains(ERR_MAINTAINER_MISMATCH),
                "wrong caller produced an undocumented error: {message}"
            );
        }

        prop_assert_eq!(fix.client.get_bounty(&id).status, BountyStatus::Submitted);
        prop_assert_eq!(fix.balance(&fix.contract), amount);
        prop_assert_eq!(fix.balance(&fix.contributor), 0);
        prop_assert_eq!(fix.client.get_fee_stats().bounty_count, 0);
    }

    /// Open and Reserved bounties of any size cannot be released.
    #[test]
    fn fuzz_release_bounty_wrong_status_rejected(
        amount in MIN_AMOUNT..=MAX_BOUNTY_AMOUNT,
        fee_bps in 0u32..=10_000u32,
    ) {
        let fix = setup_fuzz_fixture();
        let id = fix.create(amount, fee_bps);

        let message = try_release(&fix, id, &fix.maintainer)
            .expect_err("releasing an open bounty unexpectedly succeeded");
        prop_assert!(message.contains(ERR_MUST_BE_SUBMITTED), "undocumented error: {message}");
        prop_assert_eq!(fix.client.get_bounty(&id).status, BountyStatus::Open);

        fix.client.reserve_bounty(&id, &fix.contributor);
        let message = try_release(&fix, id, &fix.maintainer)
            .expect_err("releasing a reserved bounty unexpectedly succeeded");
        prop_assert!(message.contains(ERR_MUST_BE_SUBMITTED), "undocumented error: {message}");
        prop_assert_eq!(fix.client.get_bounty(&id).status, BountyStatus::Reserved);

        prop_assert_eq!(fix.balance(&fix.contract), amount);
        prop_assert_eq!(fix.client.get_fee_stats().bounty_count, 0);
    }
}

#[test]
fn fuzz_release_bounty_u64_boundary_ids() {
    let fix = setup_fuzz_fixture();
    let real_id = fix.create_submitted(500, 0);
    let boundary_ids = [
        0,
        real_id + 1,
        u32::MAX as u64,
        u32::MAX as u64 + 1,
        i64::MAX as u64,
        i64::MAX as u64 + 1,
        u64::MAX - 1,
        u64::MAX,
    ];

    for id in boundary_ids {
        assert_documented_panic(ERR_NOT_FOUND, try_release(&fix, id, &fix.maintainer));
        assert_eq!(
            fix.client.get_bounty(&real_id).status,
            BountyStatus::Submitted
        );
    }
}

#[test]
fn fuzz_release_bounty_amount_and_fee_boundaries() {
    let amounts = [
        MIN_AMOUNT,
        MIN_AMOUNT + 1,
        9_999,
        10_000,
        10_001,
        MAX_BOUNTY_AMOUNT - 1,
        MAX_BOUNTY_AMOUNT,
    ];
    let fees = [0u32, 1, 9_999, 10_000];

    for amount in amounts {
        for fee_bps in fees {
            let fix = setup_fuzz_fixture();
            let id = fix.create_submitted(amount, fee_bps);

            fix.client.release_bounty(&id, &fix.maintainer);

            let expected_fee = amount * fee_bps as i128 / 10_000;
            assert_eq!(fix.balance(&fix.treasury), expected_fee);
            assert_eq!(fix.balance(&fix.contributor), amount - expected_fee);
            assert_eq!(fix.balance(&fix.contract), 0);
            assert_eq!(fix.client.get_bounty(&id).status, BountyStatus::Released);
        }
    }
}

#[test]
fn fuzz_release_bounty_release_time_boundaries() {
    for release_time in [0, DEADLINE - 1, DEADLINE, DEADLINE + 1, u64::MAX] {
        let fix = setup_fuzz_fixture();
        let id = fix.create_submitted(1_000, 250);
        fix.env.ledger().set_timestamp(release_time);

        fix.client.release_bounty(&id, &fix.maintainer);

        assert_eq!(fix.client.get_bounty(&id).status, BountyStatus::Released);
        assert_eq!(fix.balance(&fix.treasury), 25);
        assert_eq!(fix.balance(&fix.contributor), 975);
    }
}
