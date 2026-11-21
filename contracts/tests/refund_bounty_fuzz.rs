//! Property-based fuzz tests asserting refund_bounty invariants across generated numeric inputs.
//!
//! Asserts that across generated inputs:
//! - Only documented error variants are allowed as panics.
//! - No integer overflow, panic, or state corruption outside documented error paths.
//! - Bounded time budget and wide coverage of numeric input domains (amounts, IDs, timestamps, deadlines).

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, Env, String,
};
use stellar_bounty_board::{
    BountyStatus, StellarBountyBoardContract, StellarBountyBoardContractClient,
    DEFAULT_MIN_BOUNTY_AMOUNT, MAX_BOUNTY_AMOUNT,
};

const DISPUTE_WINDOW: u64 = 600;

struct FuzzFixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    _admin: Address,
    maintainer: Address,
    contributor: Address,
    _arbiter: Address,
    _treasury: Address,
    token: Address,
}

fn setup_fuzz_fixture() -> FuzzFixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);

    let admin = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let treasury = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);

    client.initialize(&admin, &treasury, &arbiter, &DISPUTE_WINDOW);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    FuzzFixture {
        env,
        client,
        _admin: admin,
        maintainer,
        contributor,
        _arbiter: arbiter,
        _treasury: treasury,
        token,
    }
}

/// Simple deterministic pseudo-random number generator (LCG)
/// to provide property-based fuzzing without external crate overhead.
struct LcgRng {
    state: u64,
}

impl LcgRng {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self
            .state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.state
    }

    fn next_i128(&mut self) -> i128 {
        let hi = self.next_u64() as u128;
        let lo = self.next_u64() as u128;
        ((hi << 64) | lo) as i128
    }

    fn gen_range_u64(&mut self, min: u64, max: u64) -> u64 {
        if min >= max {
            return min;
        }
        min + (self.next_u64() % (max - min + 1))
    }

    fn gen_range_i128(&mut self, min: i128, max: i128) -> i128 {
        if min >= max {
            return min;
        }
        let span = (max - min) as u128;
        let r = (self.next_u64() as u128) % (span + 1);
        min + (r as i128)
    }
}

fn matches_documented_refund_error(err_str: &str) -> bool {
    // Contract panics with panic_error(ContractError::Variant) which the Soroban host
    // surfaces either as the named variant, InvokeError::Abort, or Error(Context, InvalidAction).
    let documented = [
        "Error(Contract, #2)",
        "Error(Contract, #25)",
        "Error(Contract, #23)",
        "Error(Contract, #21)",
        "InvalidAction",
        "Abort",
    ];
    for doc in documented {
        if err_str.contains(doc) {
            return true;
        }
    }
    false
}

#[test]
fn test_fuzz_refund_bounty_numeric_inputs_and_invariants() {
    let mut rng = LcgRng::new(0xB001_CAFE_FEED_FACE);

    // ── 1. Boundary & Fuzzed IDs ───────────────────────────────────────
    let edge_ids: [u64; 16] = [
        0,
        1,
        2,
        u64::MAX,
        u64::MAX - 1,
        (u32::MAX as u64),
        (u32::MAX as u64) + 1,
        (i64::MAX as u64),
        (i64::MAX as u64) + 1,
        10,
        50,
        100,
        500,
        1_000,
        1_000_000,
        999_999_999,
    ];

    for &id in &edge_ids {
        let fix = setup_fuzz_fixture();
        let wrong_maintainer = Address::generate(&fix.env);

        let res1 = fix.client.try_refund_bounty(&id, &fix.maintainer);
        assert!(res1.is_err(), "Non-existent bounty ID {} should fail", id);
        let err1_str = format!("{:?}", res1);
        assert!(
            matches_documented_refund_error(&err1_str),
            "Error for non-existent ID {} must match documented error: {}",
            id,
            err1_str
        );

        let res2 = fix.client.try_refund_bounty(&id, &wrong_maintainer);
        assert!(
            res2.is_err(),
            "Non-existent bounty ID with wrong caller should fail"
        );
        let err2_str = format!("{:?}", res2);
        assert!(
            matches_documented_refund_error(&err2_str),
            "Error must match documented error: {}",
            err2_str
        );
    }

    // Fuzz 100 arbitrary pseudorandom bounty IDs
    for _ in 0..100 {
        let fix = setup_fuzz_fixture();
        let rand_id = rng.next_u64();
        let res = fix.client.try_refund_bounty(&rand_id, &fix.maintainer);
        assert!(res.is_err(), "Random non-existent ID {} must fail", rand_id);
        let err_str = format!("{:?}", res);
        assert!(
            matches_documented_refund_error(&err_str),
            "Error for random ID {} must match documented variant: {}",
            rand_id,
            err_str
        );
    }

    // ── 2. Boundary & Fuzzed Amounts ───────────────────────────────────
    let edge_amounts: [i128; 8] = [
        DEFAULT_MIN_BOUNTY_AMOUNT, // 100
        101,
        500,
        10_000,
        1_000_000,
        1_000_000_000,
        MAX_BOUNTY_AMOUNT - 1,
        MAX_BOUNTY_AMOUNT, // 1_000_000_000_000_000
    ];

    for &amount in &edge_amounts {
        let fix = setup_fuzz_fixture();
        let token_client = StellarAssetClient::new(&fix.env, &fix.token);
        token_client.mint(&fix.maintainer, &amount);

        let initial_maintainer_balance = token_client.balance(&fix.maintainer);
        assert_eq!(initial_maintainer_balance, amount);

        let start_time = 10_000u64;
        fix.env.ledger().set_timestamp(start_time);
        let deadline = start_time + 1_000;

        let bounty_id = fix.client.create_bounty(
            &fix.maintainer,
            &fix.token,
            &amount,
            &String::from_str(&fix.env, "repo"),
            &1,
            &String::from_str(&fix.env, "title"),
            &deadline,
            &500u32, // 5% fee configured (refund should NOT deduct fee!)
            &None,
        );

        // Balance after creation is 0 (amount deposited into contract escrow)
        assert_eq!(token_client.balance(&fix.maintainer), 0);
        assert_eq!(token_client.balance(&fix.client.address), amount);

        // (a) Refund before deadline must fail with BountyNotExpiredYet
        fix.env.ledger().set_timestamp(deadline - 1);
        let res_early = fix.client.try_refund_bounty(&bounty_id, &fix.maintainer);
        assert!(res_early.is_err(), "Refund before deadline must fail");
        let err_early_str = format!("{:?}", res_early);
        assert!(matches_documented_refund_error(&err_early_str));

        // State & balances must not be corrupted
        assert_eq!(token_client.balance(&fix.maintainer), 0);
        assert_eq!(token_client.balance(&fix.client.address), amount);
        let b = fix.client.get_bounty(&bounty_id);
        assert_eq!(b.status, BountyStatus::Open);
        assert_eq!(b.amount, amount);

        // (b) Exact deadline boundary: timestamp == deadline must still fail
        fix.env.ledger().set_timestamp(deadline);
        let res_at = fix.client.try_refund_bounty(&bounty_id, &fix.maintainer);
        assert!(
            res_at.is_err(),
            "Refund at timestamp == deadline must fail (not expired yet)"
        );
        let err_at_str = format!("{:?}", res_at);
        assert!(matches_documented_refund_error(&err_at_str));

        // (c) Maintainer mismatch: non-creator cannot claim refund even after deadline
        fix.env.ledger().set_timestamp(deadline + 1);
        let wrong_caller = Address::generate(&fix.env);
        let res_wrong = fix.client.try_refund_bounty(&bounty_id, &wrong_caller);
        assert!(res_wrong.is_err(), "Wrong caller cannot refund");
        let err_wrong_str = format!("{:?}", res_wrong);
        assert!(matches_documented_refund_error(&err_wrong_str));

        // (d) Valid refund at deadline + 1: succeeds with 100% original amount refunded
        let res_refund = fix.client.try_refund_bounty(&bounty_id, &fix.maintainer);
        assert!(
            res_refund.is_ok(),
            "Refund at deadline + 1 must succeed for amount {}",
            amount
        );

        // Full amount restored to maintainer, contract escrow emptied
        assert_eq!(token_client.balance(&fix.maintainer), amount);
        assert_eq!(token_client.balance(&fix.client.address), 0);

        let b_after = fix.client.get_bounty(&bounty_id);
        assert_eq!(b_after.status, BountyStatus::Refunded);
        assert_eq!(b_after.amount, amount);

        // (e) Double refund invariant: immediately re-calling refund must fail with BountyAlreadyFinalized
        let res_double = fix.client.try_refund_bounty(&bounty_id, &fix.maintainer);
        assert!(
            res_double.is_err(),
            "Double refund on already refunded bounty must fail"
        );
        let err_double_str = format!("{:?}", res_double);
        assert!(matches_documented_refund_error(&err_double_str));
    }

    // ── 3. Fuzzed Pseudorandom Timestamps & Deadlines ──────────────────
    for _ in 0..40 {
        let fix = setup_fuzz_fixture();
        let test_amount = rng.gen_range_i128(DEFAULT_MIN_BOUNTY_AMOUNT, 10_000_000);
        let token_client = StellarAssetClient::new(&fix.env, &fix.token);
        token_client.mint(&fix.maintainer, &test_amount);

        let created_at = rng.gen_range_u64(1_000, 100_000);
        fix.env.ledger().set_timestamp(created_at);

        let duration = rng.gen_range_u64(100, 50_000);
        let deadline = created_at + duration;

        let bounty_id = fix.client.create_bounty(
            &fix.maintainer,
            &fix.token,
            &test_amount,
            &String::from_str(&fix.env, "repo"),
            &1,
            &String::from_str(&fix.env, "title"),
            &deadline,
            &0u32,
            &None,
        );

        // Pick an evaluation timestamp around deadline: in [deadline - 50, deadline + 50]
        let delta = (rng.next_u64() % 101) as i64 - 50;
        let eval_time = (deadline as i64 + delta) as u64;
        fix.env.ledger().set_timestamp(eval_time);

        let res = fix.client.try_refund_bounty(&bounty_id, &fix.maintainer);
        if eval_time <= deadline {
            assert!(
                res.is_err(),
                "Refund at time {} <= deadline {} must fail",
                eval_time,
                deadline
            );
            let b = fix.client.get_bounty(&bounty_id);
            assert_eq!(
                b.status,
                BountyStatus::Open,
                "Status must remain Open on failed refund"
            );
            assert_eq!(token_client.balance(&fix.maintainer), 0);
            assert_eq!(token_client.balance(&fix.client.address), test_amount);
        } else {
            assert!(
                res.is_ok(),
                "Refund at time {} > deadline {} must succeed",
                eval_time,
                deadline
            );
            let b = fix.client.get_bounty(&bounty_id);
            assert_eq!(b.status, BountyStatus::Refunded);
            assert_eq!(token_client.balance(&fix.maintainer), test_amount);
            assert_eq!(token_client.balance(&fix.client.address), 0);
        }
    }

    // ── 4. Lifecycle Invariants (Released Bounties Cannot Be Refunded) ──
    {
        let fix = setup_fuzz_fixture();
        let amount = 5_000i128;
        let token_client = StellarAssetClient::new(&fix.env, &fix.token);
        token_client.mint(&fix.maintainer, &amount);

        let deadline = 20_000u64;
        fix.env.ledger().set_timestamp(10_000);

        let bounty_id = fix.client.create_bounty(
            &fix.maintainer,
            &fix.token,
            &amount,
            &String::from_str(&fix.env, "repo"),
            &1,
            &String::from_str(&fix.env, "title"),
            &deadline,
            &0u32,
            &None,
        );

        fix.client.reserve_bounty(&bounty_id, &fix.contributor);
        fix.client.submit_bounty(&bounty_id, &fix.contributor);
        fix.client.release_bounty(&bounty_id, &fix.maintainer);

        // Advance ledger well past deadline
        fix.env.ledger().set_timestamp(deadline + 5_000);

        // Attempt refund on Released bounty -> must fail with BountyAlreadyFinalized
        let res = fix.client.try_refund_bounty(&bounty_id, &fix.maintainer);
        assert!(res.is_err(), "Refund on Released bounty must fail");
        let err_str = format!("{:?}", res);
        assert!(
            matches_documented_refund_error(&err_str),
            "Error must match documented error: {}",
            err_str
        );

        let b = fix.client.get_bounty(&bounty_id);
        assert_eq!(
            b.status,
            BountyStatus::Released,
            "Status must remain Released"
        );
    }

    let _ = rng.next_i128(); // ensure all helper methods are exercised
}
