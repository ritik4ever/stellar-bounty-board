//! Bounded, deterministic property tests for `reserve_bounty`'s numeric ID
//! and the deadline stored on the bounty. Kept separate from the pre-existing
//! `src/test.rs`, which does not compile on current main.

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Ledger},
    Address, Env, String,
};
use std::panic::{catch_unwind, AssertUnwindSafe};
use stellar_bounty_board::{
    Bounty, BountyStatus, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

const GENERATED_IDS: usize = 64;
const GENERATED_DEADLINES: usize = 24;

// Only records transfers; reservation must never call it. The initial create
// call is the sole expected transfer in every fixture.
#[contract]
struct CountingToken;

#[contractimpl]
impl CountingToken {
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
    contributor: Address,
    token: Address,
    bounty: Bounty,
}

fn setup(deadline: u64) -> Fixture {
    assert!(deadline > 0);
    let env = Env::default();
    env.mock_all_auths();
    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);
    let admin = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let arbiter = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env), &arbiter, &600);
    let token = env.register(CountingToken, ());
    let id = client.create_bounty(
        &maintainer,
        &token,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &deadline,
        &0,
        &None,
    );
    assert_eq!(id, 1);
    let bounty = client.get_bounty(&id);
    assert_eq!(CountingTokenClient::new(&env, &token).transfer_count(), 1);
    Fixture {
        env,
        client,
        contributor,
        token,
        bounty,
    }
}

// Fixed seed makes failures reproducible in CI. xorshift64 traverses all
// 64-bit bit positions rather than sampling only a narrow hand-picked range.
fn next_id(seed: &mut u64) -> u64 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    *seed
}

fn assert_documented_panic(f: &Fixture, id: u64, expected: &str) {
    let panic = catch_unwind(AssertUnwindSafe(|| {
        f.client.reserve_bounty(&id, &f.contributor);
    }))
    .expect_err("rejected reservation must panic");
    let message = panic
        .downcast_ref::<std::string::String>()
        .map(std::string::String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .expect("contract panic must include its documented error variant");
    assert!(
        message.contains(expected),
        "unexpected panic for ID {id}: {message}"
    );
}

#[test]
fn generated_u64_ids_reject_unknown_bounties_without_state_changes() {
    let f = setup(u64::MAX);
    let mut seed = 0x7f4a_7c15_d3b9_2e61u64;
    let mut ids = std::vec![0, 2, 3, u64::MAX - 1, u64::MAX];
    for _ in 0..GENERATED_IDS {
        let id = next_id(&mut seed);
        if id != 1 {
            ids.push(id);
        }
    }

    for id in ids {
        assert_documented_panic(&f, id, "BountyNotFound");
        assert_eq!(f.client.get_bounty(&1), f.bounty);
        assert_eq!(
            CountingTokenClient::new(&f.env, &f.token).transfer_count(),
            1
        );
    }
}

#[test]
fn generated_deadline_boundaries_preserve_reservation_invariants() {
    let mut seed = 0x25a4_9b7c_83f1_0d5eu64;
    let mut deadlines = std::vec![1, 2, u64::MAX - 1];
    for _ in 0..GENERATED_DEADLINES {
        deadlines.push(next_id(&mut seed).clamp(1, u64::MAX - 1));
    }

    for (index, deadline) in deadlines.into_iter().enumerate() {
        let f = setup(deadline);
        let now = match index % 3 {
            0 => deadline - 1,
            1 => deadline,
            _ => deadline + 1,
        };
        f.env.ledger().set_timestamp(now);

        if now <= deadline {
            f.client.reserve_bounty(&1, &f.contributor);
            let reserved = f.client.get_bounty(&1);
            assert_eq!(reserved.status, BountyStatus::Reserved);
            assert_eq!(reserved.contributor, Some(f.contributor.clone()));
            assert_eq!(reserved.amount, f.bounty.amount);
            assert_eq!(reserved.deadline, deadline);
            assert_documented_panic(&f, 1, "BountyNotOpen");
            assert_eq!(f.client.get_bounty(&1), reserved);
        } else {
            assert_documented_panic(&f, 1, "BountyNotOpen");
            // `get_bounty` computes Expired from the current clock without
            // persisting it. Restore the clock to observe the stored record.
            f.env.ledger().set_timestamp(0);
            assert_eq!(f.client.get_bounty(&1), f.bounty);
        }
        assert_eq!(
            CountingTokenClient::new(&f.env, &f.token).transfer_count(),
            1
        );
    }
}
