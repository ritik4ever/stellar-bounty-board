//! Integration tests for contract payout (`release_bounty`) atomicity (SBB-2026-422):
//! - Injecting repeated `release_bounty` calls after a failed contributor payout transfer
//! - Injecting repeated `release_bounty` calls after a failed protocol fee transfer
//! - Verifying failed calls cannot strand or multiply escrow funds, mutate `FeeStats`,
//!   or affect unrelated bounties in escrow.

use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Events as _},
    Address, Env, Error, String,
};
use stellar_bounty_board::{
    BountyStatus, ContractError, FeeStats, StellarBountyBoardContract,
    StellarBountyBoardContractClient,
};

#[contracttype]
#[derive(Clone)]
enum MockTokenKey {
    Balance(Address),
    FailAll,
    FailRecipient,
}

/// Configurable mock token contract for injecting payout/fee transfer failures
/// without using live funds.
#[contract]
struct ToggleablePayoutToken;

#[contractimpl]
impl ToggleablePayoutToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = MockTokenKey::Balance(to);
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&MockTokenKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn set_fail_all(env: Env, fail: bool) {
        env.storage().instance().set(&MockTokenKey::FailAll, &fail);
    }

    pub fn set_fail_recipient(env: Env, recipient: Option<Address>) {
        match recipient {
            Some(addr) => env
                .storage()
                .instance()
                .set(&MockTokenKey::FailRecipient, &addr),
            None => env
                .storage()
                .instance()
                .remove(&MockTokenKey::FailRecipient),
        }
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let fail_all: bool = env
            .storage()
            .instance()
            .get(&MockTokenKey::FailAll)
            .unwrap_or(false);
        if fail_all {
            panic!("simulated payout transfer failure");
        }

        if let Some(blocked) = env
            .storage()
            .instance()
            .get::<MockTokenKey, Address>(&MockTokenKey::FailRecipient)
        {
            if blocked == to {
                panic!("simulated fee transfer failure");
            }
        }

        let from_key = MockTokenKey::Balance(from);
        let to_key = MockTokenKey::Balance(to);
        let from_bal: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        assert!(from_bal >= amount, "insufficient mock token balance");
        let to_bal: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);

        env.storage()
            .persistent()
            .set(&from_key, &(from_bal - amount));
        env.storage().persistent().set(&to_key, &(to_bal + amount));
    }
}

struct PayoutFixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    token_client: ToggleablePayoutTokenClient<'static>,
    maintainer: Address,
    contributor: Address,
    fee_recipient: Address,
}

fn setup() -> PayoutFixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let token_id = env.register(ToggleablePayoutToken, ());
    let token_client = ToggleablePayoutTokenClient::new(&env, &token_id);

    let admin = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    client.initialize(&admin, &fee_recipient, &arbiter, &600);

    PayoutFixture {
        env,
        client,
        token_client,
        maintainer,
        contributor,
        fee_recipient,
    }
}

fn create_and_submit_bounty(
    f: &PayoutFixture,
    amount: i128,
    fee_bps: u32,
    issue_number: u32,
) -> u64 {
    f.token_client.mint(&f.maintainer, &amount);
    let repo = String::from_str(&f.env, "org/repo");
    let title = String::from_str(&f.env, "Payout atomicity bounty");
    let deadline = f.env.ledger().timestamp() + 1_000;

    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.token_client.address,
        &amount,
        &repo,
        &issue_number,
        &title,
        &deadline,
        &fee_bps,
        &None,
    );
    f.client.reserve_bounty(&bounty_id, &f.contributor);
    f.client.submit_bounty(&bounty_id, &f.contributor);
    bounty_id
}

#[test]
fn repeated_release_after_failed_payout_transfer_is_atomic_and_single_shot() {
    let f = setup();
    let target_amount: i128 = 10_000;
    let fee_bps: u32 = 500; // 5% -> fee = 500, net = 9_500
    let expected_fee: i128 = 500;
    let expected_net: i128 = 9_500;

    let target_id = create_and_submit_bounty(&f, target_amount, fee_bps, 1);

    // Fund an unrelated second bounty to verify escrow isolation.
    let unrelated_amount: i128 = 4_000;
    let unrelated_id = create_and_submit_bounty(&f, unrelated_amount, 0, 2);

    assert_eq!(
        f.token_client.balance(&f.client.address),
        target_amount + unrelated_amount
    );

    // Inject transfer failure and attempt release twice.
    f.token_client.set_fail_all(&true);

    for _ in 0..2 {
        assert_eq!(
            f.client.try_release_bounty(&target_id, &f.maintainer),
            Err(Ok(Error::from_contract_error(
                ContractError::PayoutTransferFailed as u32
            )))
        );

        // Status, balances, unrelated bounty, FeeStats, and events must remain unchanged.
        assert_eq!(f.client.get_bounty(&target_id).status, BountyStatus::Submitted);
        assert_eq!(
            f.client.get_bounty(&unrelated_id).status,
            BountyStatus::Submitted
        );
        assert_eq!(
            f.token_client.balance(&f.client.address),
            target_amount + unrelated_amount
        );
        assert_eq!(f.token_client.balance(&f.contributor), 0);
        assert_eq!(f.token_client.balance(&f.fee_recipient), 0);
        assert_eq!(
            f.client.get_fee_stats(),
            FeeStats {
                total_collected: 0,
                bounty_count: 0,
            }
        );
        assert_eq!(f.env.events().all().len(), 0);
    }

    // Clear transfer failure and retry release — must succeed exactly once.
    f.token_client.set_fail_all(&false);
    f.client.release_bounty(&target_id, &f.maintainer);

    assert_eq!(f.client.get_bounty(&target_id).status, BountyStatus::Released);
    assert_eq!(
        f.client.get_bounty(&unrelated_id).status,
        BountyStatus::Submitted
    );
    assert_eq!(f.token_client.balance(&f.contributor), expected_net);
    assert_eq!(f.token_client.balance(&f.fee_recipient), expected_fee);
    assert_eq!(f.token_client.balance(&f.client.address), unrelated_amount);
    assert_eq!(
        f.client.get_fee_stats(),
        FeeStats {
            total_collected: expected_fee,
            bounty_count: 1,
        }
    );

    // Repeated release after a successful settlement must fail and cannot multiply funds.
    assert_eq!(
        f.client.try_release_bounty(&target_id, &f.maintainer),
        Err(Ok(Error::from_contract_error(
            ContractError::BountyMustBeSubmitted as u32
        )))
    );
    assert_eq!(f.token_client.balance(&f.contributor), expected_net);
    assert_eq!(f.token_client.balance(&f.fee_recipient), expected_fee);
    assert_eq!(f.token_client.balance(&f.client.address), unrelated_amount);
    assert_eq!(
        f.client.get_fee_stats(),
        FeeStats {
            total_collected: expected_fee,
            bounty_count: 1,
        }
    );
}

#[test]
fn repeated_release_after_failed_fee_transfer_rolls_back_contributor_payout() {
    let f = setup();
    let amount: i128 = 20_000;
    let fee_bps: u32 = 250; // 2.5% -> fee = 500, net = 19_500
    let expected_fee: i128 = 500;
    let expected_net: i128 = 19_500;

    let bounty_id = create_and_submit_bounty(&f, amount, fee_bps, 10);

    // Fail ONLY the fee transfer so the contributor transfer executes first and then
    // the second transfer panics. Soroban must roll back both transfers and storage writes.
    f.token_client
        .set_fail_recipient(&Some(f.fee_recipient.clone()));

    for _ in 0..2 {
        assert_eq!(
            f.client.try_release_bounty(&bounty_id, &f.maintainer),
            Err(Ok(Error::from_contract_error(
                ContractError::FeeTransferFailed as u32
            )))
        );

        // Contributor payout must be rolled back; escrow holds full amount; status stays Submitted.
        assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Submitted);
        assert_eq!(f.token_client.balance(&f.contributor), 0);
        assert_eq!(f.token_client.balance(&f.fee_recipient), 0);
        assert_eq!(f.token_client.balance(&f.client.address), amount);
        assert_eq!(
            f.client.get_fee_stats(),
            FeeStats {
                total_collected: 0,
                bounty_count: 0,
            }
        );
        assert_eq!(f.env.events().all().len(), 0);
    }

    // Clear fee-recipient failure and retry release — succeeds once with exact balances.
    f.token_client.set_fail_recipient(&None);
    f.client.release_bounty(&bounty_id, &f.maintainer);

    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Released);
    assert_eq!(f.token_client.balance(&f.contributor), expected_net);
    assert_eq!(f.token_client.balance(&f.fee_recipient), expected_fee);
    assert_eq!(f.token_client.balance(&f.client.address), 0);
    assert_eq!(
        f.client.get_fee_stats(),
        FeeStats {
            total_collected: expected_fee,
            bounty_count: 1,
        }
    );

    // Subsequent release attempt is rejected without multiplying payout or fee stats.
    assert_eq!(
        f.client.try_release_bounty(&bounty_id, &f.maintainer),
        Err(Ok(Error::from_contract_error(
            ContractError::BountyMustBeSubmitted as u32
        )))
    );
    assert_eq!(f.token_client.balance(&f.contributor), expected_net);
    assert_eq!(f.token_client.balance(&f.fee_recipient), expected_fee);
    assert_eq!(f.token_client.balance(&f.client.address), 0);
    assert_eq!(
        f.client.get_fee_stats(),
        FeeStats {
            total_collected: expected_fee,
            bounty_count: 1,
        }
    );
}
