//! Property-based fuzz tests asserting get_bounty invariants across generated inputs.
//!
//! Asserts that across generated numeric inputs (bounty IDs, amounts, timestamps, deadlines, fee bps, etc.):
//! - Only documented error variants (`ContractError::BountyNotFound`) are allowed for non-existent IDs.
//! - No integer overflow, panic, or state corruption outside documented error paths.
//! - Boundary numeric values (`0`, `1`, `u32::MAX`, `u64::MAX`, `i128` min/max boundaries) are tested.
//! - Off-by-one deadline expiration invariants hold (`now <= deadline` is unexpired, `now > deadline` is expired).
//! - Non-expiring states (`Submitted`, `Disputed`, `Released`, `Refunded`) never lazily transition to `Expired`.
//! - Storage immutability holds (querying `get_bounty` is read-only and never corrupts persistent state).
//! - Runs deterministically in CI within a bounded, fast execution budget.

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};
use stellar_bounty_board::{
    BountyStatus, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

const DISPUTE_WINDOW: u64 = 600;
const DEFAULT_MIN_BOUNTY_AMOUNT: i128 = 100;
const MAX_BOUNTY_AMOUNT: i128 = 1_000_000_000_000_000;
const MAX_FEE_BPS: u32 = 1_000;

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

    fn next_u32(&mut self) -> u32 {
        (self.next_u64() >> 32) as u32
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
        let diff = (max - min) as u128;
        let rand_val = (self.next_i128().unsigned_abs()) % (diff + 1);
        min + (rand_val as i128)
    }
}

#[test]
fn test_fuzz_get_bounty_invalid_and_arbitrary_ids() {
    let mut rng = LcgRng::new(0xCAFE_BABE_9876_5432);

    // Explicit boundary edge cases for bounty_id (including 0, 1, 32-bit & 64-bit limits, powers of 2)
    let edge_ids: [u64; 22] = [
        0,
        1,
        2,
        3,
        65_535,
        65_536,
        (u32::MAX as u64) - 1,
        u32::MAX as u64,
        (u32::MAX as u64) + 1,
        (i32::MAX as u64),
        (i32::MAX as u64) + 1,
        (1u64 << 31),
        (1u64 << 32),
        (1u64 << 48),
        (1u64 << 63),
        (i64::MAX as u64) - 1,
        (i64::MAX as u64),
        (i64::MAX as u64) + 1,
        u64::MAX - 2,
        u64::MAX - 1,
        u64::MAX,
        1_000_000_007,
    ];

    let fix = setup_fuzz_fixture();

    // 1. Assert all explicit edge IDs return strictly error and documented BountyNotFound panic
    for &id in &edge_ids {
        let res = fix.client.try_get_bounty(&id);
        assert!(
            res.is_err(),
            "Non-existent edge bounty ID {} must return an error",
            id
        );

        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            fix.client.get_bounty(&id);
        }));
        assert!(
            outcome.is_err(),
            "Non-existent edge bounty ID {} must panic",
            id
        );
        let panic_payload = outcome.unwrap_err();
        let msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
            *s
        } else if let Some(s) = panic_payload.downcast_ref::<std::string::String>() {
            s.as_str()
        } else {
            ""
        };
        assert!(
            msg.contains("Error(Contract, #2)"),
            "Expected documented BountyNotFound error for edge ID {}, got panic: {}",
            id,
            msg
        );
    }

    // 2. Assert wide distribution of pseudorandom bounty IDs return strictly BountyNotFound
    for _ in 0..100 {
        let rand_id = rng.next_u64();
        let res = fix.client.try_get_bounty(&rand_id);
        assert!(
            res.is_err(),
            "Random uncreated bounty ID {} must return an error",
            rand_id
        );

        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            fix.client.get_bounty(&rand_id);
        }));
        assert!(
            outcome.is_err(),
            "Random uncreated bounty ID {} must panic",
            rand_id
        );
        let panic_payload = outcome.unwrap_err();
        let msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
            *s
        } else if let Some(s) = panic_payload.downcast_ref::<std::string::String>() {
            s.as_str()
        } else {
            ""
        };
        assert!(
            msg.contains("Error(Contract, #2)"),
            "Expected documented BountyNotFound error for random ID {}, got panic: {}",
            rand_id,
            msg
        );
    }
}

#[test]
fn test_fuzz_get_bounty_numeric_input_fields_integrity() {
    let mut rng = LcgRng::new(0xFEED_FACE_1122_3344);

    let edge_amounts: [i128; 8] = [
        DEFAULT_MIN_BOUNTY_AMOUNT,
        DEFAULT_MIN_BOUNTY_AMOUNT + 1,
        500,
        10_000,
        1_000_000,
        MAX_BOUNTY_AMOUNT / 2,
        MAX_BOUNTY_AMOUNT - 1,
        MAX_BOUNTY_AMOUNT,
    ];

    let edge_issue_numbers: [u32; 6] = [0, 1, 42, u32::MAX / 2, u32::MAX - 1, u32::MAX];

    let edge_fee_bps: [u32; 5] = [0, 1, 250, 500, MAX_FEE_BPS];

    let edge_overrides: [Option<u64>; 4] = [None, Some(60), Some(600), Some(86_400)];

    // Fuzz created bounties across Cartesian product of edge cases + random variations
    for (i, &amount) in edge_amounts.iter().enumerate() {
        let issue_num = edge_issue_numbers[i % edge_issue_numbers.len()];
        let fee_bps = edge_fee_bps[i % edge_fee_bps.len()];
        let dispute_override = edge_overrides[i % edge_overrides.len()];

        let fix = setup_fuzz_fixture();
        soroban_sdk::token::StellarAssetClient::new(&fix.env, &fix.token)
            .mint(&fix.maintainer, &amount);

        let initial_time = 10_000u64;
        let deadline = initial_time + rng.gen_range_u64(1_000, 100_000);
        fix.env.ledger().set_timestamp(initial_time);

        let bounty_id = fix.client.create_bounty(
            &fix.maintainer,
            &fix.token,
            &amount,
            &String::from_str(&fix.env, "test/repo"),
            &issue_num,
            &String::from_str(&fix.env, "Test Bounty Title"),
            &deadline,
            &fee_bps,
            &dispute_override,
        );

        // Fetch via get_bounty and verify exact numerical fields match without bit truncation or overflow
        let bounty = fix.client.get_bounty(&bounty_id);
        assert_eq!(bounty.amount, amount, "bounty amount must match exactly");
        assert_eq!(
            bounty.issue_number, issue_num,
            "issue_number must match exactly"
        );
        assert_eq!(bounty.deadline, deadline, "deadline must match exactly");
        assert_eq!(
            bounty.protocol_fee_bps, fee_bps,
            "protocol_fee_bps must match exactly"
        );
        assert_eq!(
            bounty.dispute_window_override, dispute_override,
            "override must match exactly"
        );
        assert_eq!(
            bounty.status,
            BountyStatus::Open,
            "status must be Open when now < deadline"
        );
        assert_eq!(bounty.maintainer, fix.maintainer);
        assert_eq!(bounty.token, fix.token);
    }

    // Additional randomized numeric fuzzing
    for _ in 0..30 {
        let rand_amount = rng.gen_range_i128(DEFAULT_MIN_BOUNTY_AMOUNT, MAX_BOUNTY_AMOUNT);
        let rand_issue = rng.next_u32();
        let rand_fee_bps = (rng.next_u32() % (MAX_FEE_BPS + 1)) as u32;
        let rand_override = if rng.next_u64() % 2 == 0 {
            Some(rng.gen_range_u64(60, 1_000_000))
        } else {
            None
        };

        let fix = setup_fuzz_fixture();
        soroban_sdk::token::StellarAssetClient::new(&fix.env, &fix.token)
            .mint(&fix.maintainer, &rand_amount);

        let now = rng.gen_range_u64(1_000, 10_000_000);
        let deadline = now + rng.gen_range_u64(500, 1_000_000);
        fix.env.ledger().set_timestamp(now);

        let bounty_id = fix.client.create_bounty(
            &fix.maintainer,
            &fix.token,
            &rand_amount,
            &String::from_str(&fix.env, "rand/repo"),
            &rand_issue,
            &String::from_str(&fix.env, "Random Bounty Title"),
            &deadline,
            &rand_fee_bps,
            &rand_override,
        );

        let bounty = fix.client.get_bounty(&bounty_id);
        assert_eq!(bounty.amount, rand_amount);
        assert_eq!(bounty.issue_number, rand_issue);
        assert_eq!(bounty.deadline, deadline);
        assert_eq!(bounty.protocol_fee_bps, rand_fee_bps);
        assert_eq!(bounty.dispute_window_override, rand_override);
    }
}

#[test]
fn test_fuzz_get_bounty_lazy_expiration_and_boundaries() {
    let mut rng = LcgRng::new(0x1337_BEEF_5566_7788);

    let fix = setup_fuzz_fixture();
    let amount = 5_000i128;
    soroban_sdk::token::StellarAssetClient::new(&fix.env, &fix.token)
        .mint(&fix.maintainer, &(amount * 10));

    let deadline = 50_000u64;
    fix.env.ledger().set_timestamp(1_000);

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

    let reserved_bounty_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &amount,
        &String::from_str(&fix.env, "repo"),
        &2,
        &String::from_str(&fix.env, "title"),
        &deadline,
        &0u32,
        &None,
    );
    fix.client
        .reserve_bounty(&reserved_bounty_id, &fix.contributor);

    // 1. Timestamp strictly before deadline: must be Open
    fix.env.ledger().set_timestamp(deadline - 1);
    let b_before = fix.client.get_bounty(&bounty_id);
    assert_eq!(
        b_before.status,
        BountyStatus::Open,
        "Timestamp < deadline must be Open"
    );

    // 2. Timestamp exactly equal to deadline: must still be Open (now > bounty.deadline is false)
    fix.env.ledger().set_timestamp(deadline);
    let b_at = fix.client.get_bounty(&bounty_id);
    assert_eq!(
        b_at.status,
        BountyStatus::Open,
        "Timestamp == deadline must be Open"
    );

    // 3. Timestamp exactly one second after deadline: must transition lazily to Expired
    fix.env.ledger().set_timestamp(deadline + 1);
    let b_after = fix.client.get_bounty(&bounty_id);
    assert_eq!(
        b_after.status,
        BountyStatus::Expired,
        "Timestamp == deadline + 1 must be Expired"
    );

    // 4. Timestamp far in the future (u64::MAX)
    fix.env.ledger().set_timestamp(u64::MAX);
    let b_max = fix.client.get_bounty(&bounty_id);
    assert_eq!(
        b_max.status,
        BountyStatus::Expired,
        "Timestamp == u64::MAX must be Expired"
    );

    // 5. Test Reserved status lazy expiration at boundary
    // Reserved before deadline -> status Reserved
    fix.env.ledger().set_timestamp(deadline - 10);
    let b_res_before = fix.client.get_bounty(&reserved_bounty_id);
    assert_eq!(b_res_before.status, BountyStatus::Reserved);

    // Reserved at deadline -> status Reserved
    fix.env.ledger().set_timestamp(deadline);
    let b_res_at = fix.client.get_bounty(&reserved_bounty_id);
    assert_eq!(b_res_at.status, BountyStatus::Reserved);

    // Reserved after deadline -> transitions to Expired
    fix.env.ledger().set_timestamp(deadline + 1);
    let b_res_after = fix.client.get_bounty(&reserved_bounty_id);
    assert_eq!(b_res_after.status, BountyStatus::Expired);

    // 6. Fuzz over 60 pseudorandom deadline and timestamp pairs
    for _ in 0..60 {
        let current_base = 5_000u64;
        fix.env.ledger().set_timestamp(current_base);
        soroban_sdk::token::StellarAssetClient::new(&fix.env, &fix.token)
            .mint(&fix.maintainer, &amount);

        let rand_deadline = rng.gen_range_u64(current_base + 1_000, current_base + 10_000_000);
        let b_id = fix.client.create_bounty(
            &fix.maintainer,
            &fix.token,
            &amount,
            &String::from_str(&fix.env, "repo"),
            &10,
            &String::from_str(&fix.env, "title"),
            &rand_deadline,
            &0u32,
            &None,
        );

        // Sample delta in [-100, 100]
        let delta = (rng.next_u64() % 201) as i64 - 100;
        let current_time = (rand_deadline as i64 + delta) as u64;
        fix.env.ledger().set_timestamp(current_time);

        let retrieved = fix.client.get_bounty(&b_id);
        if current_time > rand_deadline {
            assert_eq!(
                retrieved.status,
                BountyStatus::Expired,
                "For now ({}) > deadline ({}), status must be Expired",
                current_time,
                rand_deadline
            );
        } else {
            assert_eq!(
                retrieved.status,
                BountyStatus::Open,
                "For now ({}) <= deadline ({}), status must be Open",
                current_time,
                rand_deadline
            );
        }
    }
}

#[test]
fn test_fuzz_get_bounty_storage_immutability_and_state_preservation() {
    let fix = setup_fuzz_fixture();
    let amount = 2_000i128;
    soroban_sdk::token::StellarAssetClient::new(&fix.env, &fix.token)
        .mint(&fix.maintainer, &amount);

    let deadline = 10_000u64;
    fix.env.ledger().set_timestamp(5_000);

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

    // Verify initial state
    let initial = fix.client.get_bounty(&bounty_id);
    assert_eq!(initial.status, BountyStatus::Open);

    // Call get_bounty when expired
    fix.env.ledger().set_timestamp(deadline + 500);
    let expired_view = fix.client.get_bounty(&bounty_id);
    assert_eq!(expired_view.status, BountyStatus::Expired);

    // get_bounty must NOT mutate persistent storage:
    // If time is adjusted back, read_bounty will return the unchanged persistent record (Open).
    fix.env.ledger().set_timestamp(deadline - 1);
    let unexpired_view = fix.client.get_bounty(&bounty_id);
    assert_eq!(
        unexpired_view.status,
        BountyStatus::Open,
        "get_bounty must be a read-only query and not permanently corrupt or mutate storage"
    );
}

#[test]
fn test_fuzz_get_bounty_non_expiring_lifecycle_states() {
    let mut rng = LcgRng::new(0x9988_7766_5544_3322);
    let fix = setup_fuzz_fixture();
    let amount = 3_000i128;
    soroban_sdk::token::StellarAssetClient::new(&fix.env, &fix.token)
        .mint(&fix.maintainer, &(amount * 10));

    let deadline = 20_000u64;
    fix.env.ledger().set_timestamp(5_000);

    // Create a bounty and advance to Submitted
    let bounty_submitted_id = fix.client.create_bounty(
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
    fix.client
        .reserve_bounty(&bounty_submitted_id, &fix.contributor);
    fix.client
        .submit_bounty(&bounty_submitted_id, &fix.contributor);

    // Create a bounty and advance to Disputed
    let bounty_disputed_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &amount,
        &String::from_str(&fix.env, "repo"),
        &2,
        &String::from_str(&fix.env, "title"),
        &deadline,
        &0u32,
        &None,
    );
    fix.client
        .reserve_bounty(&bounty_disputed_id, &fix.contributor);
    fix.client
        .submit_bounty(&bounty_disputed_id, &fix.contributor);
    fix.client.dispute_bounty(&bounty_disputed_id, &fix.arbiter);

    // Create a bounty and advance to Released
    let bounty_released_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &amount,
        &String::from_str(&fix.env, "repo"),
        &3,
        &String::from_str(&fix.env, "title"),
        &deadline,
        &0u32,
        &None,
    );
    fix.client
        .reserve_bounty(&bounty_released_id, &fix.contributor);
    fix.client
        .submit_bounty(&bounty_released_id, &fix.contributor);
    fix.client
        .release_bounty(&bounty_released_id, &fix.maintainer);

    // Create a bounty and advance to Refunded (refund requires now > deadline)
    let bounty_refunded_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &amount,
        &String::from_str(&fix.env, "repo"),
        &4,
        &String::from_str(&fix.env, "title"),
        &deadline,
        &0u32,
        &None,
    );
    fix.env.ledger().set_timestamp(deadline + 1);
    fix.client
        .refund_bounty(&bounty_refunded_id, &fix.maintainer);

    // Fuzz timestamps far past deadline across these states
    let test_timestamps = [
        deadline + 2,
        deadline + 1_000,
        deadline + 1_000_000,
        rng.gen_range_u64(deadline + 10, u64::MAX - 1),
        u64::MAX,
    ];

    for &ts in &test_timestamps {
        fix.env.ledger().set_timestamp(ts);

        // Submitted must remain Submitted, never Expired
        let b_sub = fix.client.get_bounty(&bounty_submitted_id);
        assert_eq!(
            b_sub.status,
            BountyStatus::Submitted,
            "Submitted bounty must never expire past deadline"
        );

        // Disputed must remain Disputed, never Expired
        let b_disp = fix.client.get_bounty(&bounty_disputed_id);
        assert_eq!(
            b_disp.status,
            BountyStatus::Disputed,
            "Disputed bounty must never expire past deadline"
        );

        // Released must remain Released, never Expired
        let b_rel = fix.client.get_bounty(&bounty_released_id);
        assert_eq!(
            b_rel.status,
            BountyStatus::Released,
            "Released bounty must never expire past deadline"
        );

        // Refunded must remain Refunded, never Expired
        let b_ref = fix.client.get_bounty(&bounty_refunded_id);
        assert_eq!(
            b_ref.status,
            BountyStatus::Refunded,
            "Refunded bounty must never expire past deadline"
        );
    }
}
