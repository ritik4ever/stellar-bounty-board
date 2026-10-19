//! Coverage for the arbiter bond introduced for issue #760: an arbiter must
//! post a stake before taking office, the stake is held in the contract, and
//! the admin can forfeit it to the treasury when a ruling was bad.
//!
//! These live as an integration test rather than in `src/test.rs` because they
//! exercise the contract the way a caller does — through the generated client —
//! and because `src/test.rs` on `main` does not currently compile for unrelated
//! reasons (`setup_test` is destructured as a 6-tuple in 29 places, several
//! tests call `Ledger::set_balance` and `Deployer::get_contract_info`, neither
//! of which exists in soroban-sdk 27). Keeping this file separate means the
//! bond is verifiable today, on its own, with:
//!
//! ```text
//! cargo test --test arbiter_bond
//! ```

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, IntoVal,
};
use stellar_bounty_board::{
    ArbiterBonded, ArbiterSlashed, ArbiterStake, StellarBountyBoardContract,
    StellarBountyBoardContractClient, DEFAULT_MIN_ARBITER_STAKE,
};

const DISPUTE_WINDOW: u64 = 600;

/// A deployed contract plus the accounts and token a test needs, so each test
/// body is about the behaviour under test rather than setup boilerplate.
struct Fixture {
    env: Env,
    contract: Address,
    client: StellarBountyBoardContractClient<'static>,
    admin: Address,
    arbiter: Address,
    treasury: Address,
    candidate: Address,
    token: Address,
    fee_payer: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);

    let admin = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let treasury = Address::generate(&env);
    let candidate = Address::generate(&env);
    let fee_payer = Address::generate(&env);

    client.initialize(&admin, &treasury, &arbiter, &DISPUTE_WINDOW);

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();

    Fixture {
        env,
        contract,
        client,
        admin,
        arbiter,
        treasury,
        candidate,
        token,
        fee_payer,
    }
}

impl Fixture {
    fn mint(&self, to: &Address, amount: i128) {
        StellarAssetClient::new(&self.env, &self.token).mint(to, &amount);
    }

    fn token(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.token)
    }

    /// Bonds `amount` from `who` and returns nothing; panics inside the
    /// contract if the bond is rejected.
    fn bond(&self, who: &Address, amount: i128) {
        self.mint(who, amount);
        self.client.bond_arbiter_stake(who, &self.token, &amount);
    }

    /// A second token, to prove a bond cannot silently change denomination.
    fn other_token(&self) -> Address {
        let admin = Address::generate(&self.env);
        self.env.register_stellar_asset_contract_v2(admin).address()
    }
}

// ─── Bonding ────────────────────────────────────────────────────────────

#[test]
fn bond_moves_the_stake_into_the_contract() {
    let f = setup();
    f.bond(&f.candidate, 5_000);

    // The stake is held by the contract, not merely recorded: that is what
    // makes a slash payable without the arbiter's cooperation.
    assert_eq!(f.token().balance(&f.candidate), 0);
    assert_eq!(f.token().balance(&f.contract), 5_000);

    assert_eq!(
        f.client.get_arbiter_stake(&f.candidate),
        Some(ArbiterStake {
            token: f.token.clone(),
            amount: 5_000,
        })
    );
}

#[test]
fn bonding_twice_accumulates_into_one_stake() {
    let f = setup();
    f.bond(&f.candidate, 2_000);
    f.bond(&f.candidate, 3_000);

    assert_eq!(
        f.client.get_arbiter_stake(&f.candidate).unwrap().amount,
        5_000
    );
    assert_eq!(f.token().balance(&f.contract), 5_000);
}

#[test]
fn an_address_that_never_bonded_has_no_stake() {
    let f = setup();
    assert_eq!(f.client.get_arbiter_stake(&f.candidate), None);
}

#[test]
#[should_panic(expected = "StakeTokenMismatch")]
fn topping_up_in_a_different_token_is_rejected() {
    let f = setup();
    f.bond(&f.candidate, 5_000);

    // A bond is denominated in one token; adding a second would make "how much
    // is staked" ambiguous and the slash would have to pick a token.
    let other = f.other_token();
    StellarAssetClient::new(&f.env, &other).mint(&f.candidate, &1_000);
    f.client.bond_arbiter_stake(&f.candidate, &other, &1_000);
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn bonding_zero_is_rejected() {
    let f = setup();
    f.client.bond_arbiter_stake(&f.candidate, &f.token, &0);
}

#[test]
#[should_panic]
fn bonding_requires_the_bonders_signature() {
    // No `mock_all_auths` here on purpose: a bond that anyone could post on
    // someone else's behalf would let a griefer manufacture the appearance of
    // a stake for an address that never agreed to risk anything.
    let env = Env::default();
    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);
    let admin = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury, &arbiter, &DISPUTE_WINDOW);

    let borrower = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    client.bond_arbiter_stake(&borrower, &token, &5_000);
}

// ─── The minimum stake, and what it gates ───────────────────────────────

#[test]
fn the_minimum_stake_defaults_to_the_documented_constant() {
    let f = setup();
    assert_eq!(
        f.client.get_min_arbiter_stake(),
        DEFAULT_MIN_ARBITER_STAKE
    );
}

#[test]
fn the_arbiter_can_raise_the_minimum() {
    let f = setup();
    f.client.set_min_arbiter_stake(&7_000);
    assert_eq!(f.client.get_min_arbiter_stake(), 7_000);
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn a_minimum_of_zero_is_rejected() {
    // Zero would make the bond decorative: every address would qualify.
    let f = setup();
    f.client.set_min_arbiter_stake(&0);
}

#[test]
#[should_panic(expected = "InsufficientArbiterStake")]
fn an_unbonded_candidate_cannot_be_rotated_in() {
    let f = setup();
    f.client.set_arbiter(&f.candidate);
}

#[test]
#[should_panic(expected = "InsufficientArbiterStake")]
fn a_candidate_bonded_below_the_minimum_cannot_be_rotated_in() {
    let f = setup();
    f.bond(&f.candidate, DEFAULT_MIN_ARBITER_STAKE - 1);
    f.client.set_arbiter(&f.candidate);
}

#[test]
fn a_bonded_candidate_is_rotated_in_once_the_timelock_elapses() {
    let f = setup();
    f.bond(&f.candidate, DEFAULT_MIN_ARBITER_STAKE);

    f.client.set_arbiter(&f.candidate);

    // The rotation is timelocked, so the roster does not change yet.
    assert_eq!(f.client.get_arbiter(), f.arbiter);

    f.env.ledger().set_timestamp(2 * 86_400 + 1);
    f.client.confirm_arbiter();

    assert_eq!(f.client.get_arbiter(), f.candidate);
}

#[test]
#[should_panic(expected = "InsufficientArbiterStake")]
fn a_slash_during_the_timelock_blocks_the_rotation() {
    let f = setup();
    f.bond(&f.candidate, DEFAULT_MIN_ARBITER_STAKE);
    f.client.set_arbiter(&f.candidate);

    // The candidate is proposed but not in office yet; the admin can still
    // forfeit the bond before the timelock expires, and doing so must stop the
    // rotation rather than let an under-bonded address slip in.
    f.client.slash_arbiter(
        &f.candidate,
        &DEFAULT_MIN_ARBITER_STAKE,
        &soroban_sdk::String::from_str(&f.env, "ruling overturned"),
    );

    f.env.ledger().set_timestamp(2 * 86_400 + 1);
    f.client.confirm_arbiter();
}

#[test]
fn a_slashed_candidate_can_be_re_bonded_and_then_rotated_in() {
    let f = setup();
    f.bond(&f.candidate, DEFAULT_MIN_ARBITER_STAKE);
    f.client.slash_arbiter(
        &f.candidate,
        &1_000,
        &soroban_sdk::String::from_str(&f.env, "partial forfeit"),
    );

    // Slashing does not ban the address, it just leaves it short. Topping the
    // bond back up is what restores eligibility.
    f.bond(&f.candidate, 1_000);
    f.client.set_arbiter(&f.candidate);

    f.env.ledger().set_timestamp(2 * 86_400 + 1);
    f.client.confirm_arbiter();
    assert_eq!(f.client.get_arbiter(), f.candidate);
}

// ─── Slashing ───────────────────────────────────────────────────────────

#[test]
fn slashing_forfeits_to_the_treasury_and_leaves_the_remainder() {
    let f = setup();
    f.bond(&f.candidate, 5_000);

    f.client
        .slash_arbiter(&f.candidate, &2_000, &soroban_sdk::String::from_str(&f.env, "bad ruling"));

    assert_eq!(f.token().balance(&f.treasury), 2_000);
    assert_eq!(f.token().balance(&f.contract), 3_000);
    assert_eq!(
        f.client.get_arbiter_stake(&f.candidate).unwrap().amount,
        3_000
    );
}

#[test]
fn slashing_the_whole_bond_empties_it_without_removing_the_record() {
    let f = setup();
    f.bond(&f.candidate, 5_000);
    f.client.slash_arbiter(
        &f.candidate,
        &5_000,
        &soroban_sdk::String::from_str(&f.env, "total forfeit"),
    );

    assert_eq!(f.token().balance(&f.treasury), 5_000);
    assert_eq!(f.client.get_arbiter_stake(&f.candidate).unwrap().amount, 0);
}

#[test]
#[should_panic(expected = "SlashExceedsStake")]
fn slashing_more_than_the_bond_is_rejected() {
    // The contract can only pay out of funds it actually holds, so an
    // over-slash has to fail rather than drain other bounties' escrow.
    let f = setup();
    f.bond(&f.candidate, 5_000);
    f.client
        .slash_arbiter(&f.candidate, &5_001, &soroban_sdk::String::from_str(&f.env, "too much"));
}

#[test]
#[should_panic(expected = "NoArbiterStake")]
fn slashing_an_unbonded_address_is_rejected() {
    let f = setup();
    f.client.slash_arbiter(
        &f.candidate,
        &1,
        &soroban_sdk::String::from_str(&f.env, "nothing to slash"),
    );
}

#[test]
#[should_panic(expected = "InvalidAmount")]
fn slashing_zero_is_rejected() {
    let f = setup();
    f.bond(&f.candidate, 5_000);
    f.client
        .slash_arbiter(&f.candidate, &0, &soroban_sdk::String::from_str(&f.env, "noise"));
}

#[test]
#[should_panic]
fn slashing_requires_the_admin() {
    // Without `mock_all_auths`, the arbiter's own call must not be honoured:
    // the party being punished does not get to decide the punishment.
    let env = Env::default();
    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);
    client.initialize(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &DISPUTE_WINDOW,
    );
    client.slash_arbiter(
        &Address::generate(&env),
        &1,
        &soroban_sdk::String::from_str(&env, "unauthorised"),
    );
}

// ─── Events ─────────────────────────────────────────────────────────────

#[test]
fn bonding_publishes_the_documented_event() {
    let f = setup();
    f.bond(&f.candidate, 5_000);

    assert_eq!(
        f.env.events().all().filter_by_contract(&f.contract),
        vec![
            &f.env,
            (
                f.contract.clone(),
                (symbol_short!("Arbiter"), symbol_short!("Bonded")).into_val(&f.env),
                ArbiterBonded {
                    arbiter: f.candidate.clone(),
                    token: f.token.clone(),
                    amount: 5_000,
                    total: 5_000,
                }
                .into_val(&f.env),
            ),
        ]
    );
}

#[test]
fn slashing_publishes_the_documented_event() {
    let f = setup();
    f.bond(&f.candidate, 5_000);
    f.client.slash_arbiter(
        &f.candidate,
        &2_000,
        &soroban_sdk::String::from_str(&f.env, "bad ruling"),
    );

    // The host records the events of the most recently invoked contract call,
    // so what is on record now is this slash (and not the earlier bond).
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.contract),
        vec![
            &f.env,
            (
                f.contract.clone(),
                (symbol_short!("Arbiter"), symbol_short!("Slashed")).into_val(&f.env),
                ArbiterSlashed {
                    arbiter: f.candidate.clone(),
                    token: f.token.clone(),
                    amount: 2_000,
                    remaining: 3_000,
                    treasury: f.treasury.clone(),
                    reason: soroban_sdk::String::from_str(&f.env, "bad ruling"),
                }
                .into_val(&f.env),
            ),
        ]
    );
}

#[test]
fn the_genesis_arbiter_starts_unbonded() {
    // `initialize` deliberately does not require a bond (there is no prior
    // governance to slash it with), but the requirement applies to every
    // rotation afterwards. Pinning it here documents that asymmetry.
    let f = setup();
    assert_eq!(f.client.get_arbiter_stake(&f.arbiter), None);
    assert_eq!(f.client.get_arbiter(), f.arbiter);
}

#[test]
fn fee_payer_addresses_are_untouched_by_bonding() {
    let f = setup();
    f.bond(&f.candidate, 5_000);
    assert_eq!(f.token().balance(&f.fee_payer), 0);
    assert_eq!(f.token().balance(&f.admin), 0);
}
