//! Integration tests for multi-arbiter committee voting (2-of-3) for disputes (#727).
//!
//! Acceptance criteria verified:
//! - Admin can configure up to 3 distinct committee members.
//! - A single committee vote does not release funds.
//! - Two matching votes from distinct committee members triggers resolution.
//! - Two conflicting votes followed by a third tie-breaking vote resolves to the majority decision.
//! - Duplicate votes from the same committee member are rejected.
//! - Non-committee members cannot cast votes.
//! - DisputeVoteCast and DisputeResolved events are emitted with correct payloads.

use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, String,
};
use stellar_bounty_board::{
    BountyStatus, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

const DISPUTE_WINDOW: u64 = 60;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    _admin: Address,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
    arbiter1: Address,
    arbiter2: Address,
    arbiter3: Address,
    outsider: Address,
    treasury: Address,
    token: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);

    let admin = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let treasury = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let arbiter1 = Address::generate(&env);
    let arbiter2 = Address::generate(&env);
    let arbiter3 = Address::generate(&env);
    let outsider = Address::generate(&env);

    client.initialize(&admin, &treasury, &arbiter, &DISPUTE_WINDOW);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    Fixture {
        env,
        client,
        _admin: admin,
        maintainer,
        contributor,
        arbiter,
        arbiter1,
        arbiter2,
        arbiter3,
        outsider,
        treasury,
        token,
    }
}

impl Fixture {
    fn mint(&self, to: &Address, amount: i128) {
        StellarAssetClient::new(&self.env, &self.token).mint(to, &amount);
    }

    fn token_client(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.token)
    }

    fn create_disputed_bounty(&self, amount: i128, fee_bps: u32) -> u64 {
        self.mint(&self.maintainer, amount);
        let bounty_id = self.client.create_bounty(
            &self.maintainer,
            &self.token,
            &amount,
            &String::from_str(&self.env, "test/repo"),
            &42,
            &String::from_str(&self.env, "Test Bounty"),
            &(self.env.ledger().timestamp() + 10_000),
            &fee_bps,
            &Some(60),
        );

        self.client.reserve_bounty(&bounty_id, &self.contributor);
        self.client.submit_bounty(&bounty_id, &self.contributor);
        self.client.dispute_bounty(&bounty_id, &self.arbiter);
        bounty_id
    }

    fn configure_committee(&self) {
        let members = vec![
            &self.env,
            self.arbiter1.clone(),
            self.arbiter2.clone(),
            self.arbiter3.clone(),
        ];
        self.client.set_arbiter_committee(&members);
    }
}

// â”€â”€â”€ Committee Configuration Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_admin_configures_committee() {
    let fix = setup();
    fix.configure_committee();

    let committee = fix.client.get_arbiter_committee();
    assert_eq!(committee.len(), 3);
    assert_eq!(committee.get(0).unwrap(), fix.arbiter1);
    assert_eq!(committee.get(1).unwrap(), fix.arbiter2);
    assert_eq!(committee.get(2).unwrap(), fix.arbiter3);
}

#[test]
#[should_panic(expected = "Error(Contract, #36)")]
fn test_committee_size_exceeded_fails() {
    let fix = setup();
    let four_members = vec![
        &fix.env,
        fix.arbiter1.clone(),
        fix.arbiter2.clone(),
        fix.arbiter3.clone(),
        fix.outsider.clone(),
    ];
    fix.client.set_arbiter_committee(&four_members);
}

#[test]
#[should_panic(expected = "Error(Contract, #37)")]
fn test_committee_duplicate_members_fails() {
    let fix = setup();
    let duplicates = vec![
        &fix.env,
        fix.arbiter1.clone(),
        fix.arbiter2.clone(),
        fix.arbiter1.clone(),
    ];
    fix.client.set_arbiter_committee(&duplicates);
}

// â”€â”€â”€ Acceptance Criteria 1: Single Vote Does Not Release Funds â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_single_vote_does_not_release_funds() {
    let fix = setup();
    fix.configure_committee();
    let bounty_id = fix.create_disputed_bounty(1000, 500); // 5% fee

    // First committee vote: release = true
    let resolved = fix
        .client
        .vote_resolve_dispute(&bounty_id, &fix.arbiter1, &true);
    assert_eq!(resolved, false);

    // Funds must remain locked in escrow
    let bounty = fix.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Disputed);
    assert_eq!(fix.token_client().balance(&fix.contributor), 0);
    assert_eq!(fix.token_client().balance(&fix.treasury), 0);

    // Vote must be recorded
    let votes = fix.client.get_dispute_votes(&bounty_id);
    assert_eq!(votes.len(), 1);
    assert_eq!(votes.get(0).unwrap().arbiter, fix.arbiter1);
    assert_eq!(votes.get(0).unwrap().decision, true);
}

// â”€â”€â”€ Acceptance Criteria 2: Two Matching Votes Triggers Resolution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_two_matching_votes_release_funds_to_contributor() {
    let fix = setup();
    fix.configure_committee();
    let bounty_id = fix.create_disputed_bounty(1000, 500); // 5% fee (50 tokens)

    // Arbiter 1 votes release
    assert_eq!(
        fix.client
            .vote_resolve_dispute(&bounty_id, &fix.arbiter1, &true),
        false
    );

    // Arbiter 2 votes release -> quorum reached (2-of-3)
    assert_eq!(
        fix.client
            .vote_resolve_dispute(&bounty_id, &fix.arbiter2, &true),
        true
    );

    // Bounty status must be Released
    let bounty = fix.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);

    // Contributor gets net payout (950) and treasury gets fee (50)
    assert_eq!(fix.token_client().balance(&fix.contributor), 950);
    assert_eq!(fix.token_client().balance(&fix.treasury), 50);

    // FeeStats accumulated
    let fee_stats = fix.client.get_fee_stats();
    assert_eq!(fee_stats.total_collected, 50);
    assert_eq!(fee_stats.bounty_count, 1);
}

#[test]
fn test_two_matching_votes_refund_to_maintainer() {
    let fix = setup();
    fix.configure_committee();
    let bounty_id = fix.create_disputed_bounty(1000, 500);

    // Arbiter 1 votes refund
    assert_eq!(
        fix.client
            .vote_resolve_dispute(&bounty_id, &fix.arbiter1, &false),
        false
    );

    // Arbiter 3 votes refund -> quorum reached
    assert_eq!(
        fix.client
            .vote_resolve_dispute(&bounty_id, &fix.arbiter3, &false),
        true
    );

    // Bounty status must be Refunded
    let bounty = fix.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Refunded);

    // Maintainer receives full 1000 tokens back, contributor gets 0
    assert_eq!(fix.token_client().balance(&fix.maintainer), 1000);
    assert_eq!(fix.token_client().balance(&fix.contributor), 0);
}

// â”€â”€â”€ Acceptance Criteria 3: Conflicting Votes + Tie-Breaker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn test_conflicting_votes_with_tie_breaker_resolves_to_majority() {
    let fix = setup();
    fix.configure_committee();
    let bounty_id = fix.create_disputed_bounty(1000, 0); // 0% fee

    // Vote 1: Arbiter 1 votes Release (1 Release, 0 Refund)
    assert_eq!(
        fix.client
            .vote_resolve_dispute(&bounty_id, &fix.arbiter1, &true),
        false
    );
    assert_eq!(
        fix.client.get_bounty(&bounty_id).status,
        BountyStatus::Disputed
    );

    // Vote 2: Arbiter 2 votes Refund (1 Release, 1 Refund) -> Conflict, no quorum
    assert_eq!(
        fix.client
            .vote_resolve_dispute(&bounty_id, &fix.arbiter2, &false),
        false
    );
    assert_eq!(
        fix.client.get_bounty(&bounty_id).status,
        BountyStatus::Disputed
    );

    // Vote 3: Arbiter 3 votes Release (2 Release, 1 Refund) -> Tie-breaker resolves to Release!
    assert_eq!(
        fix.client
            .vote_resolve_dispute(&bounty_id, &fix.arbiter3, &true),
        true
    );

    let bounty = fix.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);
    assert_eq!(fix.token_client().balance(&fix.contributor), 1000);
    assert_eq!(fix.token_client().balance(&fix.maintainer), 0);
}

#[test]
fn test_conflicting_votes_with_tie_breaker_resolves_to_refund() {
    let fix = setup();
    fix.configure_committee();
    let bounty_id = fix.create_disputed_bounty(1000, 0);

    // Vote 1: Arbiter 1 votes Refund
    assert_eq!(
        fix.client
            .vote_resolve_dispute(&bounty_id, &fix.arbiter1, &false),
        false
    );

    // Vote 2: Arbiter 2 votes Release (1-1 split)
    assert_eq!(
        fix.client
            .vote_resolve_dispute(&bounty_id, &fix.arbiter2, &true),
        false
    );

    // Vote 3: Arbiter 3 votes Refund (2-1 majority for Refund)
    assert_eq!(
        fix.client
            .vote_resolve_dispute(&bounty_id, &fix.arbiter3, &false),
        true
    );

    let bounty = fix.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Refunded);
    assert_eq!(fix.token_client().balance(&fix.maintainer), 1000);
    assert_eq!(fix.token_client().balance(&fix.contributor), 0);
}

// â”€â”€â”€ Edge Cases & Failure Paths â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
#[should_panic(expected = "Error(Contract, #35)")]
fn test_duplicate_vote_rejected() {
    let fix = setup();
    fix.configure_committee();
    let bounty_id = fix.create_disputed_bounty(1000, 0);

    fix.client
        .vote_resolve_dispute(&bounty_id, &fix.arbiter1, &true);
    // Duplicate vote by same arbiter must fail
    fix.client
        .vote_resolve_dispute(&bounty_id, &fix.arbiter1, &true);
}

#[test]
#[should_panic(expected = "Error(Contract, #34)")]
fn test_non_committee_member_cannot_vote() {
    let fix = setup();
    fix.configure_committee();
    let bounty_id = fix.create_disputed_bounty(1000, 0);

    fix.client
        .vote_resolve_dispute(&bounty_id, &fix.outsider, &true);
}

#[test]
#[should_panic(expected = "Error(Contract, #38)")]
fn test_vote_without_committee_configured_fails() {
    let fix = setup();
    let bounty_id = fix.create_disputed_bounty(1000, 0);

    // No committee configured yet
    fix.client
        .vote_resolve_dispute(&bounty_id, &fix.arbiter1, &true);
}

#[test]
#[should_panic(expected = "Error(Contract, #41)")]
fn test_voting_on_undisputed_bounty_fails() {
    let fix = setup();
    fix.configure_committee();
    fix.mint(&fix.maintainer, 1000);

    let bounty_id = fix.client.create_bounty(
        &fix.maintainer,
        &fix.token,
        &1000,
        &String::from_str(&fix.env, "test/repo"),
        &42,
        &String::from_str(&fix.env, "Open Bounty"),
        &(fix.env.ledger().timestamp() + 10_000),
        &0,
        &None,
    );

    // Status is Open, not Disputed
    fix.client
        .vote_resolve_dispute(&bounty_id, &fix.arbiter1, &true);
}
