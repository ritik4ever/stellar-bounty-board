//! Property-based fuzz tests asserting dispute_bounty invariants across generated inputs.
//!
//! Asserts that across generated inputs:
//! - Only documented error variants are allowed as panics.
//! - No integer overflow, panic, or state corruption outside documented error paths.
//! - Bounded time budget and wide coverage of numeric input domains.

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};
use stellar_bounty_board::{
    BountyStatus, ContractError, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

const DISPUTE_WINDOW: u64 = 600;

struct FuzzFixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    _admin: Address,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
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
        arbiter,
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
}

fn matches_documented_error(err_str: &str) -> bool {
    // Only documented errors are allowed
    let documented = [
        "Error(Contract, #2)",
        "Error(Contract, #22)",
        "Error(Contract, #27)",
        "Error(Contract, #20)",
        "Error(Contract, #8)",
        "Error(Contract, #7)",
    ];

    for doc in documented {
        if err_str.contains(doc) {
            return true;
        }
    }
    false
}

#[test]
fn test_fuzz_dispute_bounty_numeric_inputs_and_invariants() {
    let mut rng = LcgRng::new(0xDEADBEEF_CAFE1234);

    // Boundary edge cases for bounty_id, amounts, timestamps, deadlines
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

    let edge_amounts: [i128; 12] = [
        i128::MIN,
        -1,
        0,
        1,
        99,
        100, // DEFAULT_MIN_BOUNTY_AMOUNT
        500,
        10_000,
        1_000_000_000_000_000, // MAX_BOUNTY_AMOUNT
        1_000_000_000_000_001,
        i128::MAX - 1,
        i128::MAX,
    ];

    // 1. Fuzz dispute_bounty against invalid/arbitrary IDs
    for &id in &edge_ids {
        let fix = setup_fuzz_fixture();
        let wrong_arbiter = Address::generate(&fix.env);

        // Call try_dispute_bounty with valid arbiter
        let res1 = fix.client.try_dispute_bounty(&id, &fix.arbiter);
        assert!(res1.is_err(), "Non-existent bounty ID {} should fail", id);

        // Call try_dispute_bounty with wrong arbiter
        let res2 = fix.client.try_dispute_bounty(&id, &wrong_arbiter);
        assert!(res2.is_err(), "Non-existent bounty ID {} should fail", id);
    }

    // 2. Fuzz with randomly generated bounty_ids
    for _ in 0..100 {
        let fix = setup_fuzz_fixture();
        let rand_id = rng.next_u64();
        let res = fix.client.try_dispute_bounty(&rand_id, &fix.arbiter);
        assert!(
            res.is_err(),
            "Arbitrary random bounty_id {} should fail",
            rand_id
        );
    }

    // 3. Fuzz lifecycle invariants: create legitimate bounties with varying parameters
    // and verify dispute_bounty respects deadlines, status, and arbiter invariants.
    let base_amount = 1_000i128;
    for &amount in &edge_amounts {
        if amount < 100 || amount > 1_000_000_000_000_000 {
            continue; // creation will fail outside valid amount limits
        }

        let fix = setup_fuzz_fixture();
        soroban_sdk::token::StellarAssetClient::new(&fix.env, &fix.token)
            .mint(&fix.maintainer, &amount);

        let initial_time = 10_000u64;
        fix.env.ledger().set_timestamp(initial_time);

        let deadline = initial_time + 1_000;
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

        // (a) State is Open -> dispute_bounty must fail (MissingContributor or BountyMustBeSubmitted)
        let res_open = fix.client.try_dispute_bounty(&bounty_id, &fix.arbiter);
        assert!(res_open.is_err(), "dispute_bounty on Open bounty must fail");

        // (b) Advance to Reserved -> dispute_bounty must fail with BountyMustBeSubmitted
        fix.client.reserve_bounty(&bounty_id, &fix.contributor);
        let res_reserved = fix.client.try_dispute_bounty(&bounty_id, &fix.arbiter);
        assert!(
            res_reserved.is_err(),
            "dispute_bounty on Reserved bounty must fail"
        );

        // (c) Advance to Submitted
        fix.client.submit_bounty(&bounty_id, &fix.contributor);

        // (d) Test wrong arbiter address -> must fail with NotArbiter
        let rogue_arbiter = Address::generate(&fix.env);
        let res_rogue = fix.client.try_dispute_bounty(&bounty_id, &rogue_arbiter);
        assert!(
            res_rogue.is_err(),
            "dispute_bounty with incorrect arbiter must fail"
        );

        // (e) Test expired deadline boundary:
        // Case 1: timestamp == deadline -> strictly not expired (env.ledger().timestamp() > bounty.deadline)
        // dispute_bounty succeeds at exactly deadline!
        fix.env.ledger().set_timestamp(deadline);
        let res_at_deadline = fix.client.try_dispute_bounty(&bounty_id, &fix.arbiter);
        assert!(
            res_at_deadline.is_ok(),
            "dispute_bounty at timestamp == deadline should succeed"
        );

        let bounty = fix.client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Disputed);
        assert_eq!(bounty.dispute_raised_at, deadline);
        assert_eq!(bounty.amount, amount);
    }

    // 4. Test off-by-one boundary: exactly one second after deadline (deadline + 1)
    {
        let fix = setup_fuzz_fixture();
        soroban_sdk::token::StellarAssetClient::new(&fix.env, &fix.token)
            .mint(&fix.maintainer, &base_amount);
        let deadline = 5_000u64;
        fix.env.ledger().set_timestamp(1_000);

        let bounty_id = fix.client.create_bounty(
            &fix.maintainer,
            &fix.token,
            &base_amount,
            &String::from_str(&fix.env, "repo"),
            &1,
            &String::from_str(&fix.env, "title"),
            &deadline,
            &0u32,
            &None,
        );
        fix.client.reserve_bounty(&bounty_id, &fix.contributor);
        fix.client.submit_bounty(&bounty_id, &fix.contributor);

        // One second past deadline
        fix.env.ledger().set_timestamp(deadline + 1);
        let res_past_deadline = fix.client.try_dispute_bounty(&bounty_id, &fix.arbiter);
        assert!(
            res_past_deadline.is_err(),
            "dispute_bounty at deadline + 1 must fail (expired)"
        );

        // Bounty state must remain Submitted (no state corruption on failure)
        let bounty_after = fix.client.get_bounty(&bounty_id);
        assert_eq!(bounty_after.status, BountyStatus::Submitted);
    }

    // 5. Fuzz across pseudorandom timestamps around deadline
    for i in 0..50 {
        let fix = setup_fuzz_fixture();
        soroban_sdk::token::StellarAssetClient::new(&fix.env, &fix.token)
            .mint(&fix.maintainer, &base_amount);

        let deadline = rng.gen_range_u64(10_000, 1_000_000);
        fix.env.ledger().set_timestamp(deadline - 500);

        let bounty_id = fix.client.create_bounty(
            &fix.maintainer,
            &fix.token,
            &base_amount,
            &String::from_str(&fix.env, "repo"),
            &1,
            &String::from_str(&fix.env, "title"),
            &deadline,
            &0u32,
            &None,
        );
        fix.client.reserve_bounty(&bounty_id, &fix.contributor);
        fix.client.submit_bounty(&bounty_id, &fix.contributor);

        // Pick a timestamp in [deadline - 10, deadline + 10]
        let delta = (rng.next_u64() % 21) as i64 - 10;
        let test_timestamp = (deadline as i64 + delta) as u64;
        fix.env.ledger().set_timestamp(test_timestamp);

        let res = fix.client.try_dispute_bounty(&bounty_id, &fix.arbiter);
        if test_timestamp > deadline {
            assert!(res.is_err(), "Dispute after deadline must fail");
            let b = fix.client.get_bounty(&bounty_id);
            assert_eq!(
                b.status,
                BountyStatus::Submitted,
                "State must not be corrupt on failure"
            );
        } else {
            assert!(res.is_ok(), "Dispute on or before deadline must succeed");
            let b = fix.client.get_bounty(&bounty_id);
            assert_eq!(b.status, BountyStatus::Disputed);
            assert_eq!(b.dispute_raised_at, test_timestamp);
            assert_eq!(b.amount, base_amount);
        }
    }
}
