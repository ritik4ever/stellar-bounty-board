#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, FromVal, String, Symbol, Vec,
};

fn setup(
    env: &Env,
) -> (
    StellarBountyBoardContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    env.mock_all_auths();
    let contract_id = env.register_contract(None, StellarBountyBoardContract);
    let client = StellarBountyBoardContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let maintainer = Address::generate(env);
    let contributor = Address::generate(env);
    let fee_recipient = Address::generate(env);
    let arbiter = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin).address();
    client.initialize(&admin, &fee_recipient, &arbiter, &600);
    (
        client,
        maintainer,
        contributor,
        token_id,
        fee_recipient,
        arbiter,
    )
}

fn create(
    env: &Env,
    client: &StellarBountyBoardContractClient<'static>,
    maintainer: &Address,
    token_id: &Address,
    amount: i128,
    fee_bps: u32,
) -> u64 {
    let mint = StellarAssetClient::new(env, token_id);
    mint.mint(maintainer, &amount);
    client.create_bounty(
        maintainer,
        token_id,
        &amount,
        &String::from_str(env, "repo"),
        &1,
        &String::from_str(env, "escrow-event-test"),
        &(env.ledger().timestamp() + 1000),
        &fee_bps,
        &None,
    )
}

fn changes(
    env: &Env,
    client: &StellarBountyBoardContractClient<'static>,
) -> Vec<EscrowBalanceChanged> {
    let mut results = Vec::new(env);
    let events = env.events().all().filter_by_contract(&client.address);
    for event in events.events().iter() {
        let soroban_sdk::xdr::ContractEventBody::V0(body) = &event.body;
        if body.topics.len() != 2 {
            continue;
        }
        let domain = Symbol::from_val(env, &body.topics[0]);
        let action = Symbol::from_val(env, &body.topics[1]);
        if domain == symbol_short!("Escrow") && action == symbol_short!("Balance") {
            results.push_back(EscrowBalanceChanged::from_val(env, &body.data));
        }
    }
    results
}

#[test]
fn funding_and_release_emit_one_balance_change_each_in_the_funded_asset() {
    let env = Env::default();
    let (client, maintainer, contributor, token_id, fee_recipient, _) = setup(&env);
    let id = create(&env, &client, &maintainer, &token_id, 101, 500);
    let token = TokenClient::new(&env, &token_id);

    assert_eq!(changes(&env, &client).len(), 1);
    assert_eq!(
        changes(&env, &client).get(0),
        Some(EscrowBalanceChanged {
            bounty_id: id,
            token: token_id.clone(),
            delta: 101,
            remaining: 101,
            status: BountyStatus::Open,
        })
    );

    client.reserve_bounty(&id, &contributor);
    client.submit_bounty(&id, &contributor);
    // Reservation/submission must not be misreported as asset movements.
    assert_eq!(changes(&env, &client).len(), 1);

    client.release_bounty(&id, &maintainer);
    assert_eq!(changes(&env, &client).len(), 2);
    assert_eq!(
        changes(&env, &client).get(1),
        Some(EscrowBalanceChanged {
            bounty_id: id,
            token: token_id.clone(),
            delta: -101,
            remaining: 0,
            status: BountyStatus::Released,
        })
    );
    assert_eq!(client.get_bounty(&id).status, BountyStatus::Released);
    assert_eq!(token.balance(&client.address), 0);
    assert_eq!(token.balance(&contributor), 96);
    assert_eq!(token.balance(&fee_recipient), 5);
}

#[test]
fn cancellation_emits_a_single_debit_after_refund() {
    let env = Env::default();
    let (client, maintainer, _, token_id, _, _) = setup(&env);
    let id = create(&env, &client, &maintainer, &token_id, 255, 0);
    client.cancel_bounty(&id, &maintainer);
    let events = changes(&env, &client);
    assert_eq!(events.len(), 2);
    assert_eq!(events.get(1).unwrap().delta, -255);
    assert_eq!(events.get(1).unwrap().remaining, 0);
    assert_eq!(events.get(1).unwrap().token, token_id.clone());
    assert_eq!(events.get(1).unwrap().status, BountyStatus::Refunded);
    assert_eq!(TokenClient::new(&env, &token_id).balance(&client.address), 0);
}

#[test]
fn expiry_refund_emits_one_debit_and_retry_does_not_repeat_it() {
    let env = Env::default();
    let (client, maintainer, _, token_id, _, _) = setup(&env);
    let id = create(&env, &client, &maintainer, &token_id, 333, 0);
    env.ledger().set_timestamp(env.ledger().timestamp() + 1001);
    client.refund_bounty(&id, &maintainer);
    assert_eq!(changes(&env, &client).len(), 2);
    assert_eq!(changes(&env, &client).get(1).unwrap().delta, -333);
    let retry = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.refund_bounty(&id, &maintainer);
    }));
    assert!(retry.is_err());
    assert_eq!(changes(&env, &client).len(), 2);
}

#[test]
fn insufficient_funding_emits_no_escrow_change() {
    let env = Env::default();
    let (client, maintainer, _, token_id, _, _) = setup(&env);
    // The maintainer owns no tokens. Funding must fail atomically.
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_bounty(
            &maintainer,
            &token_id,
            &500,
            &String::from_str(&env, "repo"),
            &1,
            &String::from_str(&env, "unfunded"),
            &(env.ledger().timestamp() + 1000),
            &0,
            &None,
        );
    }));
    assert!(outcome.is_err());
    assert_eq!(changes(&env, &client).len(), 0);
}
