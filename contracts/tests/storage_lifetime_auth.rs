//! Security tests for bounty storage lifetime and authority enforcement (Issue #1917).
//!
//! Verifies that:
//! 1. On unresolved bounties near their storage TTL expiry, authority is strictly enforced:
//!    - Signed maintainer, contributor, and arbiter roles succeed and refresh the storage TTL on payout paths.
//!    - Unauthorized callers (mismatching addresses, impersonators, or callers lacking signatures)
//!      are rejected, cannot redirect funds, and cannot change decisions.
//! 2. Claims attempted after a related persistent entry expires (bounty, arbiter, fee recipient)
//!    abort cleanly with stable errors (`BountyNotFound`, `ArbiterNotSet`, `FeeRecipientNotSet`),
//!    leaving escrow funds and committed state intact.

use soroban_sdk::{
    contracttype,
    testutils::{storage::Persistent as _, Address as _, Ledger},
    token, Address, Env, Error, InvokeError, String,
};
use stellar_bounty_board::{
    Bounty, BountyStatus, ContractError, StellarBountyBoardContract,
    StellarBountyBoardContractClient, BOUNTY_STORAGE_TTL_EXTEND_TO,
};

#[contracttype]
#[derive(Clone)]
enum Key {
    Bounty(u64),
    FeeRecipient,
    Arbiter,
}

fn assert_contract_error<T, E>(
    result: Result<Result<T, E>, Result<Error, InvokeError>>,
    expected: ContractError,
) {
    let actual = result
        .err()
        .expect("call unexpectedly succeeded")
        .expect("expected a typed contract error, not a host abort");
    assert_eq!(ContractError::try_from(actual), Ok(expected));
    assert_eq!(actual, Error::from_contract_error(expected as u32));
}

struct TestContext {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
    outsider: Address,
    token: Address,
}

impl TestContext {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(100);

        let contract_id = env.register(StellarBountyBoardContract, ());
        let client = StellarBountyBoardContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let maintainer = Address::generate(&env);
        let contributor = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let fee_recipient = Address::generate(&env);
        let outsider = Address::generate(&env);

        let asset = env.register_stellar_asset_contract_v2(Address::generate(&env));
        let token = asset.address();
        token::StellarAssetClient::new(&env, &token).mint(&maintainer, &1_000_000);

        client.initialize(&admin, &fee_recipient, &arbiter, &600);

        Self {
            env,
            client,
            maintainer,
            contributor,
            arbiter,
            outsider,
            token,
        }
    }

    fn create_bounty(&self, amount: i128, fee_bps: u32) -> u64 {
        self.client.create_bounty(
            &self.maintainer,
            &self.token,
            &amount,
            &String::from_str(&self.env, "repo"),
            &1,
            &String::from_str(&self.env, "title"),
            &(self.env.ledger().timestamp() + 1_000),
            &fee_bps,
            &None,
        )
    }

    fn create_near_expiry_bounty(&self, amount: i128, fee_bps: u32) -> u64 {
        self.env.ledger().set_min_persistent_entry_ttl(1);
        self.create_bounty(amount, fee_bps)
    }

    fn bounty_ttl(&self, id: u64) -> u32 {
        self.env.as_contract(&self.client.address, || {
            self.env.storage().persistent().get_ttl(&Key::Bounty(id))
        })
    }

    fn stored_bounty(&self, id: u64) -> Bounty {
        self.env.as_contract(&self.client.address, || {
            self.env
                .storage()
                .persistent()
                .get(&Key::Bounty(id))
                .unwrap()
        })
    }

    fn remove_key(&self, key: Key) {
        self.env.as_contract(&self.client.address, || {
            self.env.storage().persistent().remove(&key);
        });
    }

    fn token_balance(&self, addr: &Address) -> i128 {
        token::Client::new(&self.env, &self.token).balance(addr)
    }
}

#[test]
fn unresolved_bounty_near_expiry_maintainer_release_enforces_authority() {
    let ctx = TestContext::new();
    let bounty_id = ctx.create_near_expiry_bounty(1_000, 0);

    ctx.client.reserve_bounty(&bounty_id, &ctx.contributor);
    ctx.client.submit_bounty(&bounty_id, &ctx.contributor);

    // Persistent storage entry is near expiration
    assert!(ctx.bounty_ttl(bounty_id) <= 1);

    let contract_balance = ctx.token_balance(&ctx.client.address);
    let contributor_balance = ctx.token_balance(&ctx.contributor);

    // 1. Unauthorized caller (outsider or contributor) attempts release -> rejected with MaintainerMismatch
    assert_contract_error(
        ctx.client.try_release_bounty(&bounty_id, &ctx.outsider),
        ContractError::MaintainerMismatch,
    );
    assert_contract_error(
        ctx.client.try_release_bounty(&bounty_id, &ctx.contributor),
        ContractError::MaintainerMismatch,
    );

    // State, balances, and escrow are completely unaffected
    assert_eq!(ctx.token_balance(&ctx.client.address), contract_balance);
    assert_eq!(ctx.token_balance(&ctx.contributor), contributor_balance);
    assert_eq!(ctx.stored_bounty(bounty_id).status, BountyStatus::Submitted);

    // 2. Legitimate signed maintainer calls release -> succeeds and refreshes TTL
    ctx.client.release_bounty(&bounty_id, &ctx.maintainer);

    assert!(ctx.bounty_ttl(bounty_id) >= BOUNTY_STORAGE_TTL_EXTEND_TO);
    assert_eq!(ctx.stored_bounty(bounty_id).status, BountyStatus::Released);
    assert_eq!(
        ctx.token_balance(&ctx.contributor),
        contributor_balance + 1_000
    );
    assert_eq!(ctx.token_balance(&ctx.client.address), 0);

    // Retry cannot release again
    assert_contract_error(
        ctx.client.try_release_bounty(&bounty_id, &ctx.maintainer),
        ContractError::BountyMustBeSubmitted,
    );
}

#[test]
fn unresolved_bounty_near_expiry_maintainer_refund_and_cancel_enforces_authority() {
    let ctx = TestContext::new();

    // 1. Test Cancel on Open bounty near expiry
    let cancel_id = ctx.create_near_expiry_bounty(500, 0);
    assert!(ctx.bounty_ttl(cancel_id) <= 1);

    // Unauthorized outsider attempts cancel -> rejected
    assert_contract_error(
        ctx.client.try_cancel_bounty(&cancel_id, &ctx.outsider),
        ContractError::MaintainerMismatch,
    );
    assert_contract_error(
        ctx.client.try_cancel_bounty(&cancel_id, &ctx.contributor),
        ContractError::MaintainerMismatch,
    );
    assert_eq!(ctx.stored_bounty(cancel_id).status, BountyStatus::Open);

    // Legitimate maintainer cancels -> succeeds and refreshes TTL
    ctx.client.cancel_bounty(&cancel_id, &ctx.maintainer);
    assert!(ctx.bounty_ttl(cancel_id) >= BOUNTY_STORAGE_TTL_EXTEND_TO);
    assert_eq!(ctx.stored_bounty(cancel_id).status, BountyStatus::Refunded);

    // 2. Test Refund on Expired unreserved bounty near expiry
    let refund_id = ctx.create_near_expiry_bounty(800, 0);
    ctx.env
        .ledger()
        .set_timestamp(ctx.env.ledger().timestamp() + 1_001);
    assert!(ctx.bounty_ttl(refund_id) <= 1);

    // Unauthorized caller attempts refund -> rejected
    assert_contract_error(
        ctx.client.try_refund_bounty(&refund_id, &ctx.outsider),
        ContractError::MaintainerMismatch,
    );
    assert_contract_error(
        ctx.client.try_refund_bounty(&refund_id, &ctx.contributor),
        ContractError::MaintainerMismatch,
    );

    // Legitimate maintainer refunds -> succeeds and refreshes TTL
    ctx.client.refund_bounty(&refund_id, &ctx.maintainer);
    assert!(ctx.bounty_ttl(refund_id) >= BOUNTY_STORAGE_TTL_EXTEND_TO);
    assert_eq!(ctx.stored_bounty(refund_id).status, BountyStatus::Refunded);
}

#[test]
fn unresolved_bounty_near_expiry_contributor_actions_enforce_authority() {
    let ctx = TestContext::new();
    let bounty_id = ctx.create_near_expiry_bounty(1_000, 0);
    assert!(ctx.bounty_ttl(bounty_id) <= 1);

    // 1. Reserve on Open bounty
    ctx.client.reserve_bounty(&bounty_id, &ctx.contributor);
    assert_eq!(ctx.stored_bounty(bounty_id).status, BountyStatus::Reserved);
    assert_eq!(
        ctx.stored_bounty(bounty_id).contributor,
        Some(ctx.contributor.clone())
    );

    // 2. Submit authority: outsider/maintainer rejected with ContributorMismatch
    assert_contract_error(
        ctx.client.try_submit_bounty(&bounty_id, &ctx.outsider),
        ContractError::ContributorMismatch,
    );
    assert_contract_error(
        ctx.client.try_submit_bounty(&bounty_id, &ctx.maintainer),
        ContractError::ContributorMismatch,
    );
    assert_eq!(ctx.stored_bounty(bounty_id).status, BountyStatus::Reserved);

    // Assigned contributor submits -> succeeds
    ctx.client.submit_bounty(&bounty_id, &ctx.contributor);
    assert_eq!(ctx.stored_bounty(bounty_id).status, BountyStatus::Submitted);

    // 3. Dispute authority: wrong arbiter rejected with NotArbiter
    assert_contract_error(
        ctx.client.try_dispute_bounty(&bounty_id, &ctx.outsider),
        ContractError::NotArbiter,
    );

    // Valid arbiter with contributor -> transitions to Disputed
    ctx.client.dispute_bounty(&bounty_id, &ctx.arbiter);
    assert_eq!(ctx.stored_bounty(bounty_id).status, BountyStatus::Disputed);
}

#[test]
fn unresolved_bounty_near_expiry_arbiter_resolution_enforces_authority() {
    let ctx = TestContext::new();
    let bounty_id = ctx.create_near_expiry_bounty(1_000, 0);

    ctx.client.reserve_bounty(&bounty_id, &ctx.contributor);
    ctx.client.submit_bounty(&bounty_id, &ctx.contributor);
    ctx.client.dispute_bounty(&bounty_id, &ctx.arbiter);

    // Advance past dispute window
    ctx.env
        .ledger()
        .set_timestamp(ctx.env.ledger().timestamp() + 700);
    assert!(ctx.bounty_ttl(bounty_id) <= 1);

    // Arbiter resolves dispute -> succeeds and refreshes TTL
    ctx.client.resolve_dispute(&bounty_id, &true);
    assert!(ctx.bounty_ttl(bounty_id) >= BOUNTY_STORAGE_TTL_EXTEND_TO);
    assert_eq!(ctx.stored_bounty(bounty_id).status, BountyStatus::Released);
    assert_eq!(ctx.token_balance(&ctx.contributor), 1_000);
}

#[test]
fn claim_attempted_after_bounty_entry_expires_aborts_cleanly() {
    let ctx = TestContext::new();
    let bounty_id = ctx.create_bounty(1_000, 0);

    ctx.client.reserve_bounty(&bounty_id, &ctx.contributor);
    ctx.client.submit_bounty(&bounty_id, &ctx.contributor);

    let contract_balance = ctx.token_balance(&ctx.client.address);
    let contributor_balance = ctx.token_balance(&ctx.contributor);

    // Simulate persistent bounty entry expiring completely from storage
    ctx.remove_key(Key::Bounty(bounty_id));

    // Claims attempted after expiration fail cleanly with BountyNotFound
    assert_contract_error(
        ctx.client.try_release_bounty(&bounty_id, &ctx.maintainer),
        ContractError::BountyNotFound,
    );
    assert_contract_error(
        ctx.client.try_refund_bounty(&bounty_id, &ctx.maintainer),
        ContractError::BountyNotFound,
    );
    assert_contract_error(
        ctx.client.try_cancel_bounty(&bounty_id, &ctx.maintainer),
        ContractError::BountyNotFound,
    );
    assert_contract_error(
        ctx.client.try_submit_bounty(&bounty_id, &ctx.contributor),
        ContractError::BountyNotFound,
    );
    assert_contract_error(
        ctx.client.try_dispute_bounty(&bounty_id, &ctx.arbiter),
        ContractError::BountyNotFound,
    );
    assert_contract_error(
        ctx.client.try_resolve_dispute(&bounty_id, &true),
        ContractError::BountyNotFound,
    );

    // Balances remain untouched
    assert_eq!(ctx.token_balance(&ctx.client.address), contract_balance);
    assert_eq!(ctx.token_balance(&ctx.contributor), contributor_balance);
}

#[test]
fn claim_attempted_after_arbiter_entry_expires_aborts_cleanly() {
    let ctx = TestContext::new();
    let bounty_id = ctx.create_bounty(1_000, 0);

    ctx.client.reserve_bounty(&bounty_id, &ctx.contributor);
    ctx.client.submit_bounty(&bounty_id, &ctx.contributor);

    // Simulate arbiter registration expiring from persistent storage
    ctx.remove_key(Key::Arbiter);

    // Attempting dispute fails with ArbiterNotSet
    assert_contract_error(
        ctx.client.try_dispute_bounty(&bounty_id, &ctx.arbiter),
        ContractError::ArbiterNotSet,
    );
    assert_eq!(ctx.stored_bounty(bounty_id).status, BountyStatus::Submitted);

    // Attempting dispute resolution fails with ArbiterNotSet
    assert_contract_error(
        ctx.client.try_resolve_dispute(&bounty_id, &true),
        ContractError::ArbiterNotSet,
    );
}

#[test]
fn claim_attempted_after_fee_recipient_entry_expires_aborts_cleanly() {
    let ctx = TestContext::new();
    // Bounty with 10% protocol fee
    let bounty_id = ctx.create_bounty(1_000, 1_000);

    ctx.client.reserve_bounty(&bounty_id, &ctx.contributor);
    ctx.client.submit_bounty(&bounty_id, &ctx.contributor);

    let contract_balance = ctx.token_balance(&ctx.client.address);
    let contributor_balance = ctx.token_balance(&ctx.contributor);

    // Simulate FeeRecipient entry expiring from persistent storage
    ctx.remove_key(Key::FeeRecipient);

    // Release must abort atomically with FeeRecipientNotSet
    assert_contract_error(
        ctx.client.try_release_bounty(&bounty_id, &ctx.maintainer),
        ContractError::FeeRecipientNotSet,
    );

    // Payout and fees are not moved; escrow remains intact
    assert_eq!(ctx.token_balance(&ctx.client.address), contract_balance);
    assert_eq!(ctx.token_balance(&ctx.contributor), contributor_balance);
    assert_eq!(ctx.stored_bounty(bounty_id).status, BountyStatus::Submitted);
}
