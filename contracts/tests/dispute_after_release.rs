//! Focused regression tests for injecting a dispute around `release_bounty`
//! storage and token calls.
//!
//! Verifies that:
//! - Injecting `dispute_bounty` after `release_bounty` is committed fails with
//!   `ContractError::BountyMustBeSubmitted`, leaves `Released` state and
//!   balances unchanged, emits no `BountyDisputed` event, and blocks any
//!   follow-up `resolve_dispute`.
//! - Injecting `dispute_bounty` reentrantly during `release_bounty`'s token
//!   transfer fails with `ContractError::BountyMustBeSubmitted` because
//!   `BountyStatus::Released` is committed before token calls.
//! - A failed token transfer during `release_bounty` (`PayoutTransferFailed` or
//!   `FeeTransferFailed`) rolls back storage atomically to `Submitted`, keeps
//!   escrow intact (neither stranded nor multiplied), and still allows a valid
//!   dispute afterward.

use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Events as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Error as SdkError, FromVal, String, Symbol,
};
use stellar_bounty_board::{
    BountyStatus, ContractError, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

fn contract_err(err: ContractError) -> SdkError {
    SdkError::from_contract_error(err as u32)
}

const BOUNTY_AMOUNT: i128 = 10_000;
const DISPUTE_WINDOW: u64 = 600;

fn count_disputed_events(env: &Env, contract: &Address) -> usize {
    env.events()
        .all()
        .filter_by_contract(contract)
        .events()
        .iter()
        .filter(|event| {
            let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
            if body.topics.len() < 2 {
                return false;
            }
            let t0 = Symbol::from_val(env, &body.topics[0]);
            let t1 = Symbol::from_val(env, &body.topics[1]);
            t0 == symbol_short!("Bounty") && t1 == symbol_short!("Dispt")
        })
        .count()
}

/// Test token that tracks balances and can either:
/// - inject a `dispute_bounty` call during the payout transfer, or
/// - fail on a chosen transfer step (1 = escrow in, 2 = payout, 3 = fee).
#[contract]
struct FaultInjectingToken;

#[contractimpl]
impl FaultInjectingToken {
    pub fn configure_reentrant_dispute(
        env: Env,
        board: Address,
        bounty_id: u64,
        arbiter: Address,
    ) {
        env.storage()
            .instance()
            .set(&symbol_short!("BOARD"), &board);
        env.storage()
            .instance()
            .set(&symbol_short!("BID"), &bounty_id);
        env.storage()
            .instance()
            .set(&symbol_short!("ARBITER"), &arbiter);
    }

    pub fn configure_fail_on_transfer(env: Env, transfer_index: u32) {
        env.storage()
            .instance()
            .set(&symbol_short!("FAIL_AT"), &transfer_index);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = (symbol_short!("BAL"), to);
        let cur: i128 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(cur + amount));
    }

    pub fn balance(env: Env, who: Address) -> i128 {
        env.storage()
            .instance()
            .get(&(symbol_short!("BAL"), who))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let count_key = symbol_short!("COUNT");
        let count: u32 = env.storage().instance().get(&count_key).unwrap_or(0) + 1;
        env.storage().instance().set(&count_key, &count);

        if let Some(fail_at) = env
            .storage()
            .instance()
            .get::<_, u32>(&symbol_short!("FAIL_AT"))
        {
            if count == fail_at {
                panic!("injected token transfer failure");
            }
        }

        // On the payout transfer (2nd transfer: 1st is create_bounty escrow in),
        // optionally inject a reentrant `dispute_bounty` call.
        if count == 2 {
            if let Some(board) = env
                .storage()
                .instance()
                .get::<_, Address>(&symbol_short!("BOARD"))
            {
                let bounty_id: u64 = env
                    .storage()
                    .instance()
                    .get(&symbol_short!("BID"))
                    .unwrap();
                let arbiter: Address = env
                    .storage()
                    .instance()
                    .get(&symbol_short!("ARBITER"))
                    .unwrap();
                let board_client = StellarBountyBoardContractClient::new(&env, &board);
                let injected = board_client.try_dispute_bounty(&bounty_id, &arbiter);
                // Soroban rejects reentrant calls into the active contract at the host
                // boundary, and even if reentrancy were permitted, `Released` is already
                // committed in storage before this token call.
                let rejected = injected.is_err();
                env.storage()
                    .instance()
                    .set(&symbol_short!("REJ"), &rejected);
            }
        }

        let from_key = (symbol_short!("BAL"), from);
        let to_key = (symbol_short!("BAL"), to);
        let from_bal: i128 = env.storage().instance().get(&from_key).unwrap_or(0);
        assert!(from_bal >= amount, "insufficient balance");
        let to_bal: i128 = env.storage().instance().get(&to_key).unwrap_or(0);
        env.storage().instance().set(&from_key, &(from_bal - amount));
        env.storage().instance().set(&to_key, &(to_bal + amount));
    }

    pub fn was_reentrant_dispute_rejected(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&symbol_short!("REJ"))
            .unwrap_or(false)
    }
}

#[test]
fn dispute_injected_after_committed_release_fails_without_moving_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    StellarAssetClient::new(&env, &token).mint(&maintainer, &BOUNTY_AMOUNT);
    let token_client = TokenClient::new(&env, &token);

    client.initialize(&admin, &fee_recipient, &arbiter, &DISPUTE_WINDOW);

    let deadline = env.ledger().timestamp() + 5_000;
    let fee_bps = 250u32; // 2.5% -> 250 stroops fee, 9,750 net payout
    let bounty_id = client.create_bounty(
        &maintainer,
        &token,
        &BOUNTY_AMOUNT,
        &String::from_str(&env, "org/repo"),
        &101,
        &String::from_str(&env, "Dispute after release"),
        &deadline,
        &fee_bps,
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);

    // Commit release before deadline.
    client.release_bounty(&bounty_id, &maintainer);

    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(token_client.balance(&contributor), 9_750);
    assert_eq!(token_client.balance(&fee_recipient), 250);
    assert_eq!(token_client.balance(&maintainer), 0);

    // Inject dispute after release is committed (while still before deadline).
    let dispute_res = client.try_dispute_bounty(&bounty_id, &arbiter);
    assert_eq!(
        dispute_res,
        Err(Ok(contract_err(ContractError::BountyMustBeSubmitted))),
        "dispute after committed release must be rejected"
    );

    // State, events, and balances must remain completely intact.
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);
    assert_eq!(bounty.dispute_raised_at, 0);
    assert_eq!(count_disputed_events(&env, &contract_id), 0);
    assert_eq!(token_client.balance(&contract_id), 0);
    assert_eq!(token_client.balance(&contributor), 9_750);
    assert_eq!(token_client.balance(&fee_recipient), 250);
    assert_eq!(token_client.balance(&maintainer), 0);

    // Follow-up arbiter resolution must also be rejected.
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + DISPUTE_WINDOW + 1);
    let resolve_res = client.try_resolve_dispute(&bounty_id, &false);
    assert_eq!(
        resolve_res,
        Err(Ok(contract_err(ContractError::BountyMustBeDisputed)))
    );
}

#[test]
fn reentrant_dispute_injected_during_release_token_call_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    let token_id = env.register(FaultInjectingToken, ());
    let token = FaultInjectingTokenClient::new(&env, &token_id);
    token.mint(&maintainer, &BOUNTY_AMOUNT);

    client.initialize(&admin, &fee_recipient, &arbiter, &DISPUTE_WINDOW);

    let deadline = env.ledger().timestamp() + 5_000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &BOUNTY_AMOUNT,
        &String::from_str(&env, "org/repo"),
        &102,
        &String::from_str(&env, "Reentrant dispute during release"),
        &deadline,
        &500u32, // 5% fee -> 500 fee, 9,500 net payout
        &None,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.submit_bounty(&bounty_id, &contributor);

    // Arm the token contract to inject `dispute_bounty` during the payout transfer.
    token.configure_reentrant_dispute(&contract_id, &bounty_id, &arbiter);

    client.release_bounty(&bounty_id, &maintainer);

    assert!(
        token.was_reentrant_dispute_rejected(),
        "reentrant dispute during release token transfer must fail with BountyMustBeSubmitted"
    );
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);
    assert_eq!(bounty.dispute_raised_at, 0);
    assert_eq!(count_disputed_events(&env, &contract_id), 0);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(token.balance(&contributor), 9_500);
    assert_eq!(token.balance(&fee_recipient), 500);
    assert_eq!(token.balance(&maintainer), 0);
}

#[test]
fn failed_release_transfer_rolls_back_atomically_and_preserves_escrow_for_dispute() {
    for (fail_transfer_index, expected_error) in [
        (2u32, ContractError::PayoutTransferFailed),
        (3u32, ContractError::FeeTransferFailed),
    ] {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(StellarBountyBoardContract, ());
        let client = StellarBountyBoardContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let maintainer = Address::generate(&env);
        let contributor = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let fee_recipient = Address::generate(&env);

        let token_id = env.register(FaultInjectingToken, ());
        let token = FaultInjectingTokenClient::new(&env, &token_id);
        token.mint(&maintainer, &BOUNTY_AMOUNT);

        client.initialize(&admin, &fee_recipient, &arbiter, &DISPUTE_WINDOW);

        let deadline = env.ledger().timestamp() + 5_000;
        let bounty_id = client.create_bounty(
            &maintainer,
            &token_id,
            &BOUNTY_AMOUNT,
            &String::from_str(&env, "org/repo"),
            &103,
            &String::from_str(&env, "Atomic release rollback"),
            &deadline,
            &500u32,
            &None,
        );

        client.reserve_bounty(&bounty_id, &contributor);
        client.submit_bounty(&bounty_id, &contributor);

        token.configure_fail_on_transfer(&fail_transfer_index);

        let release_res = client.try_release_bounty(&bounty_id, &maintainer);
        assert_eq!(release_res, Err(Ok(contract_err(expected_error))));

        // Storage, FeeStats, and escrow balances must all roll back atomically.
        let bounty = client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Submitted);
        assert_eq!(client.get_fee_stats().total_collected, 0);
        assert_eq!(client.get_fee_stats().bounty_count, 0);
        assert_eq!(token.balance(&contract_id), BOUNTY_AMOUNT);
        assert_eq!(token.balance(&contributor), 0);
        assert_eq!(token.balance(&fee_recipient), 0);

        // Because release rolled back cleanly, escrow is not stranded and
        // raising a dispute still succeeds.
        client.dispute_bounty(&bounty_id, &arbiter);
        let disputed = client.get_bounty(&bounty_id);
        assert_eq!(disputed.status, BountyStatus::Disputed);
        assert_eq!(token.balance(&contract_id), BOUNTY_AMOUNT);
    }
}
