//! Regression coverage for SBB-2026-438 (#1907): arbiter resolution authority
//! must be tied to the bounty's lifecycle, not only to the signer.
//!
//! Two invariants are exercised end to end:
//! 1. Only the stored arbiter can schedule or settle a dispute.
//! 2. A scheduled ruling is invalidated by every competing settlement path, so
//!    the same escrow can never be paid twice out of the contract's pooled
//!    balance.

use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env, String,
};
use stellar_bounty_board::{
    BountyStatus, ContractError, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
    arbiter1: Address,
    arbiter2: Address,
    token: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let arbiter1 = Address::generate(&env);
    let arbiter2 = Address::generate(&env);

    // Both the dispute window and the appeal window are zero so each
    // settlement path is reachable in the same test without time travel.
    client.initialize(&admin, &treasury, &arbiter, &0);
    client.init(&0_u64);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    Fixture {
        env,
        client,
        maintainer,
        contributor,
        arbiter,
        arbiter1,
        arbiter2,
        token,
    }
}

impl Fixture {
    fn mint(&self, to: &Address, amount: i128) {
        StellarAssetClient::new(&self.env, &self.token).mint(to, &amount);
    }

    fn balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.env, &self.token).balance(who)
    }

    fn contract_balance(&self) -> i128 {
        self.balance(&self.client.address)
    }

    fn create_bounty(&self, amount: i128, fee_bps: u32) -> u64 {
        self.mint(&self.maintainer, amount);
        self.client.create_bounty(
            &self.maintainer,
            &self.token,
            &amount,
            &String::from_str(&self.env, "acme/repo"),
            &42,
            &String::from_str(&self.env, "Guarded payout"),
            &(self.env.ledger().timestamp() + 10_000),
            &fee_bps,
            &None,
        )
    }

    fn create_disputed_bounty(&self, amount: i128, fee_bps: u32) -> u64 {
        let bounty_id = self.create_bounty(amount, fee_bps);
        self.client.reserve_bounty(&bounty_id, &self.contributor);
        self.client.submit_bounty(&bounty_id, &self.contributor);
        self.client.dispute_bounty(&bounty_id, &self.arbiter);
        bounty_id
    }
}

#[test]
fn arbiter_release_ruling_pays_once_and_clears_pending() {
    let f = setup();
    let bounty_id = f.create_disputed_bounty(1_000, 0);

    f.client.propose_resolution(&bounty_id, &0);
    f.client.finalize_resolution(&bounty_id);

    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Released);
    assert_eq!(f.balance(&f.contributor), 1_000);
    assert_eq!(f.contract_balance(), 0);

    // The ruling was consumed: replaying finalize cannot pay again.
    assert!(f.client.try_finalize_resolution(&bounty_id).is_err());
    assert_eq!(f.balance(&f.contributor), 1_000);
    assert_eq!(f.contract_balance(), 0);
}

#[test]
fn non_arbiter_cannot_schedule_or_settle_a_dispute() {
    let f = setup();
    let bounty_id = f.create_disputed_bounty(1_000, 0);

    // Drop every mocked authorization: the arbiter's signature is now required
    // and must be the one the host checks.
    f.env.mock_auths(&[]);

    assert!(f.client.try_propose_resolution(&bounty_id, &0_u32).is_err());
    assert!(f.client.try_resolve_dispute(&bounty_id, &true).is_err());

    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Disputed);
    assert_eq!(f.balance(&f.contributor), 0);
    assert_eq!(f.balance(&f.maintainer), 0);
    assert_eq!(f.contract_balance(), 1_000);
}

#[test]
fn ruling_cannot_be_scheduled_for_a_bounty_that_is_not_disputed() {
    let f = setup();
    let bounty_id = f.create_bounty(1_000, 0);

    let rejected = f
        .client
        .try_propose_resolution(&bounty_id, &0_u32)
        .err()
        .expect("scheduling for an open bounty must fail")
        .expect("expected a typed contract error, not a host abort");
    assert_eq!(
        ContractError::try_from(rejected),
        Ok(ContractError::BountyMustBeDisputed)
    );
    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Open);
    assert_eq!(f.contract_balance(), 1_000);
}

#[test]
fn direct_arbiter_settlement_invalidates_a_scheduled_ruling() {
    let f = setup();
    let disputed = f.create_disputed_bounty(1_000, 0);
    // A second bounty keeps real escrow in the pool, so a replay would have
    // funds available and must be stopped by the lifecycle guard, not by a
    // failing balance.
    let _other = f.create_bounty(1_000, 0);
    assert_eq!(f.contract_balance(), 2_000);

    f.client.propose_resolution(&disputed, &0);
    f.client.resolve_dispute(&disputed, &true);
    assert_eq!(f.balance(&f.contributor), 1_000);

    assert!(f.client.try_finalize_resolution(&disputed).is_err());
    assert_eq!(f.balance(&f.contributor), 1_000);
    assert_eq!(f.contract_balance(), 1_000, "other bounty escrow untouched");
}

#[test]
fn committee_quorum_invalidates_a_scheduled_ruling() {
    let f = setup();
    let disputed = f.create_disputed_bounty(1_000, 0);
    let _other = f.create_bounty(1_000, 0);
    f.client
        .set_arbiter_committee(&vec![&f.env, f.arbiter1.clone(), f.arbiter2.clone()]);

    f.client.propose_resolution(&disputed, &0);
    assert_eq!(
        f.client
            .vote_resolve_dispute(&disputed, &f.arbiter1, &true),
        false
    );
    assert_eq!(
        f.client
            .vote_resolve_dispute(&disputed, &f.arbiter2, &true),
        true
    );
    assert_eq!(f.client.get_bounty(&disputed).status, BountyStatus::Released);
    assert_eq!(f.balance(&f.contributor), 1_000);

    assert!(f.client.try_finalize_resolution(&disputed).is_err());
    assert_eq!(f.balance(&f.contributor), 1_000);
    assert_eq!(f.contract_balance(), 1_000, "other bounty escrow untouched");
}
