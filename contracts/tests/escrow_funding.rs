//! Integration tests for bounty escrow funding (`create_bounty`):
//! - Minimum supported amount (`DEFAULT_MIN_BOUNTY_AMOUNT`) in an allowlisted token
//! - Explicit authorization for signed maintainer, contributor, and arbiter roles
//! - Atomic rollback when token transfer fails after bounty validation passes

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
    token::{Client as TokenClient, StellarAssetClient},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal, String, Symbol, TryFromVal, Val,
};
use stellar_bounty_board::{
    BountyStatus, ContractError, StellarBountyBoardContract, StellarBountyBoardContractClient,
    DEFAULT_MIN_BOUNTY_AMOUNT,
};

/// A token contract that passes allowlist registration but always fails on `transfer`.
#[contract]
struct FailingToken;

#[contractimpl]
impl FailingToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {
        panic!("simulated transfer failure");
    }
}

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    admin: Address,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
    accepted_token: Address,
    unaccepted_token: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);

    let admin = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    client.initialize(&admin, &fee_recipient, &arbiter, &600);

    let token_admin = Address::generate(&env);
    let accepted_token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let unaccepted_token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    // Enable token allowlist and register only `accepted_token`.
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "set_allowlist_enabled",
            args: (&admin, &true).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.set_allowlist_enabled(&admin, &true);

    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "add_allowed_token",
            args: (&admin, &accepted_token).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.add_allowed_token(&admin, &accepted_token);

    Fixture {
        env,
        client,
        admin,
        maintainer,
        contributor,
        arbiter,
        accepted_token,
        unaccepted_token,
    }
}

fn mint_token(env: &Env, token: &Address, to: &Address, amount: i128) {
    let asset = StellarAssetClient::new(env, token);
    env.mock_all_auths();
    asset.mint(to, &amount);
    env.mock_auths(&[]);
}

/// Decoded view of the canonical escrow funding event emitted by `create_bounty`.
///
/// The event is published by the bounty board contract under the `escrow_funded`
/// topic with a data payload of:
/// `(bounty_id, token, amount, delta, previous_remaining, committed_remaining, status)`.
#[derive(Debug, PartialEq, Eq)]
struct EscrowFundingEvent {
    bounty_id: u64,
    token: Address,
    amount: i128,
    delta: i128,
    previous_remaining: i128,
    committed_remaining: i128,
    status: BountyStatus,
}

/// Collects every escrow funding event emitted by the bounty board contract.
fn escrow_funding_events(env: &Env, contract: &Address) -> soroban_sdk::Vec<EscrowFundingEvent> {
    let mut out = soroban_sdk::Vec::new(env);
    let topic = Symbol::new(env, "escrow_funded");
    for (emitting_contract, topics, data) in env.events().all().iter() {
        if &emitting_contract != contract {
            continue;
        }
        if topics.len() != 1 {
            continue;
        }
        let first: Val = topics.get(0).unwrap();
        let Ok(sym) = Symbol::try_from_val(env, &first) else {
            continue;
        };
        if sym != topic {
            continue;
        }
        let tuple = <(
            u64,
            Address,
            i128,
            i128,
            i128,
            i128,
            BountyStatus,
        )>::try_from_val(env, &data)
            .expect("escrow_funded payload must match canonical schema");
        out.push_back(EscrowFundingEvent {
            bounty_id: tuple.0,
            token: tuple.1,
            amount: tuple.2,
            delta: tuple.3,
            previous_remaining: tuple.4,
            committed_remaining: tuple.5,
            status: tuple.6,
        });
    }
    out
}

#[test]
fn minimum_supported_amount_in_accepted_token_succeeds_for_signed_maintainer() {
    let f = setup();
    let min_amount = DEFAULT_MIN_BOUNTY_AMOUNT;
    mint_token(&f.env, &f.accepted_token, &f.maintainer, min_amount);
    mint_token(&f.env, &f.unaccepted_token, &f.maintainer, min_amount);

    let repo = String::from_str(&f.env, "org/repo");
    let title = String::from_str(&f.env, "Minimum amount bounty");
    let deadline = f.env.ledger().timestamp() + 1_000;

    // Below minimum amount is rejected before transfer.
    let below_min = min_amount - 1;
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &below_min,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert_eq!(
        f.client.try_create_bounty(
            &f.maintainer,
            &f.accepted_token,
            &below_min,
            &repo,
            &1,
            &title,
            &deadline,
            &0,
            &None,
        ),
        Err(Ok(Error::from_contract_error(
            ContractError::AmountTooSmall as u32
        )))
    );

    // Unaccepted token at minimum amount is rejected before transfer.
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.unaccepted_token,
                &min_amount,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert_eq!(
        f.client.try_create_bounty(
            &f.maintainer,
            &f.unaccepted_token,
            &min_amount,
            &repo,
            &1,
            &title,
            &deadline,
            &0,
            &None,
        ),
        Err(Ok(Error::from_contract_error(
            ContractError::TokenNotAllowed as u32
        )))
    );

    // Exact minimum supported amount in the accepted token succeeds when signed by maintainer.
    let transfer_sub = MockAuthInvoke {
        contract: &f.accepted_token,
        fn_name: "transfer",
        args: (&f.maintainer, &f.client.address, &min_amount).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &min_amount,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[transfer_sub],
        },
    }]);

    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.accepted_token,
        &min_amount,
        &repo,
        &1,
        &title,
        &deadline,
        &0,
        &None,
    );

    assert_eq!(bounty_id, 1);
    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Open);
    assert_eq!(bounty.maintainer, f.maintainer);
    assert_eq!(bounty.token, f.accepted_token);
    assert_eq!(bounty.amount, min_amount);

    let accepted = TokenClient::new(&f.env, &f.accepted_token);
    assert_eq!(accepted.balance(&f.maintainer), 0);
    assert_eq!(accepted.balance(&f.client.address), min_amount);

    // Exactly one escrow balance is held for the bounty, in exact token units.
    assert_eq!(accepted.balance(&f.client.address), bounty.amount);
    assert_eq!(accepted.balance(&f.client.address), min_amount);

    // The bounty ID is preserved: the funded bounty is retrievable by the returned ID
    // and no other bounty IDs were consumed.
    assert_eq!(f.client.get_bounty(&bounty_id).amount, min_amount);
    assert!(f.client.try_get_bounty(&(bounty_id + 1)).is_err());

    // Exactly one canonical escrow funding event records the committed balance.
    let events = escrow_funding_events(&f.env, &f.client.address);
    assert_eq!(events.len(), 1);
    let event = events.get(0).unwrap();
    assert_eq!(event.bounty_id, bounty_id);
    assert_eq!(event.token, f.accepted_token);
    assert_eq!(event.amount, min_amount);
    assert_eq!(event.delta, min_amount);
    assert_eq!(event.previous_remaining, 0);
    assert_eq!(event.committed_remaining, min_amount);
    assert_eq!(event.status, BountyStatus::Open);
}

#[test]
fn below_minimum_amount_is_rejected_atomically_without_escrow_or_id_consumption() {
    let f = setup();
    let min_amount = DEFAULT_MIN_BOUNTY_AMOUNT;
    let below_min = min_amount - 1;
    // Fund the maintainer with more than enough so only the amount check can fail.
    mint_token(&f.env, &f.accepted_token, &f.maintainer, min_amount);

    let repo = String::from_str(&f.env, "org/repo");
    let title = String::from_str(&f.env, "Below minimum amount");
    let deadline = f.env.ledger().timestamp() + 1_000;

    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &below_min,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert_eq!(
        f.client.try_create_bounty(
            &f.maintainer,
            &f.accepted_token,
            &below_min,
            &repo,
            &1,
            &title,
            &deadline,
            &0,
            &None,
        ),
        Err(Ok(Error::from_contract_error(
            ContractError::AmountTooSmall as u32
        )))
    );

    // Rejection is atomic: no token movement, no escrow balance, no bounty, no event.
    let accepted = TokenClient::new(&f.env, &f.accepted_token);
    assert_eq!(accepted.balance(&f.maintainer), min_amount);
    assert_eq!(accepted.balance(&f.client.address), 0);
    assert!(f.client.try_get_bounty(&1).is_err());
    assert_eq!(
        escrow_funding_events(&f.env, &f.client.address).len(),
        0,
        "no escrow funding event may be emitted when the amount is below minimum"
    );

    // No bounty ID was consumed: the next successful funding still gets ID 1.
    let transfer_sub = MockAuthInvoke {
        contract: &f.accepted_token,
        fn_name: "transfer",
        args: (&f.maintainer, &f.client.address, &min_amount).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &min_amount,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[transfer_sub],
        },
    }]);
    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.accepted_token,
        &min_amount,
        &repo,
        &1,
        &title,
        &deadline,
        &0,
        &None,
    );
    assert_eq!(bounty_id, 1);
    assert_eq!(accepted.balance(&f.client.address), min_amount);
    assert_eq!(f.client.get_bounty(&bounty_id).amount, min_amount);
}

#[test]
fn signed_contributor_and_arbiter_cannot_fund_or_redirect_minimum_amount_bounty() {
    let f = setup();
    let min_amount = DEFAULT_MIN_BOUNTY_AMOUNT;
    mint_token(&f.env, &f.accepted_token, &f.maintainer, min_amount);

    let repo = String::from_str(&f.env, "org/repo");
    let title = String::from_str(&f.env, "Role isolation");
    let deadline = f.env.ledger().timestamp() + 1_000;
    let auth_error = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));

    // Neither contributor nor arbiter can fund a bounty on behalf of the maintainer.
    for (role, signer) in [
        ("contributor", f.contributor.clone()),
        ("arbiter", f.arbiter.clone()),
    ] {
        let transfer_sub = MockAuthInvoke {
            contract: &f.accepted_token,
            fn_name: "transfer",
            args: (&f.maintainer, &f.client.address, &min_amount).into_val(&f.env),
            sub_invokes: &[],
        };
        f.env.mock_auths(&[MockAuth {
            address: &signer,
            invoke: &MockAuthInvoke {
                contract: &f.client.address,
                fn_name: "create_bounty",
                args: (
                    &f.maintainer,
                    &f.accepted_token,
                    &min_amount,
                    &repo,
                    &1u32,
                    &title,
                    &deadline,
                    &0u32,
                    &None::<u64>,
                )
                    .into_val(&f.env),
                sub_invokes: &[transfer_sub],
            },
        }]);
        assert_eq!(
            f.client.try_create_bounty(
                &f.maintainer,
                &f.accepted_token,
                &min_amount,
                &repo,
                &1,
                &title,
                &deadline,
                &0,
                &None,
            ),
            Err(Ok(auth_error)),
            "{role} must not fund or create the maintainer's bounty"
        );
    }

    let accepted = TokenClient::new(&f.env, &f.accepted_token);
    assert_eq!(accepted.balance(&f.maintainer), min_amount);
    assert_eq!(accepted.balance(&f.client.address), 0);
    assert!(f.client.try_get_bounty(&1).is_err());

    // Maintainer funds the bounty legitimately.
    let transfer_sub = MockAuthInvoke {
        contract: &f.accepted_token,
        fn_name: "transfer",
        args: (&f.maintainer, &f.client.address, &min_amount).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &min_amount,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[transfer_sub],
        },
    }]);
    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.accepted_token,
        &min_amount,
        &repo,
        &1,
        &title,
        &deadline,
        &0,
        &None,
    );
    assert_eq!(bounty_id, 1);

    // Signed contributor and arbiter cannot cancel or redirect the funded escrow.
    for (role, signer) in [
        ("contributor", f.contributor.clone()),
        ("arbiter", f.arbiter.clone()),
    ] {
        f.env.mock_auths(&[MockAuth {
            address: &signer,
            invoke: &MockAuthInvoke {
                contract: &f.client.address,
                fn_name: "cancel_bounty",
                args: (&bounty_id, &signer).into_val(&f.env),
                sub_invokes: &[],
            },
        }]);
        assert_eq!(
            f.client.try_cancel_bounty(&bounty_id, &signer),
            Err(Ok(Error::from_contract_error(
                ContractError::MaintainerMismatch as u32
            ))),
            "{role} must not cancel or redirect maintainer escrow"
        );
    }

    assert_eq!(f.client.get_bounty(&bounty_id).status, BountyStatus::Open);
    assert_eq!(accepted.balance(&f.client.address), min_amount);
}

#[test]
fn token_transfer_failure_after_validation_reverts_atomically() {
    let f = setup();
    let min_amount = DEFAULT_MIN_BOUNTY_AMOUNT;
    // Fund maintainer with 1 stroop less than the minimum required amount so all
    // bounty validations pass, then the SAC token transfer fails.
    mint_token(&f.env, &f.accepted_token, &f.maintainer, min_amount - 1);

    let repo = String::from_str(&f.env, "org/repo");
    let title = String::from_str(&f.env, "Transfer failure rollback");
    let deadline = f.env.ledger().timestamp() + 1_000;

    let transfer_sub = MockAuthInvoke {
        contract: &f.accepted_token,
        fn_name: "transfer",
        args: (&f.maintainer, &f.client.address, &min_amount).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &min_amount,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[transfer_sub],
        },
    }]);

    assert_eq!(
        f.client.try_create_bounty(
            &f.maintainer,
            &f.accepted_token,
            &min_amount,
            &repo,
            &1,
            &title,
            &deadline,
            &0,
            &None,
        ),
        Err(Ok(Error::from_contract_error(
            ContractError::EscrowTransferFailed as u32
        )))
    );

    let accepted = TokenClient::new(&f.env, &f.accepted_token);
    assert_eq!(accepted.balance(&f.maintainer), min_amount - 1);
    assert_eq!(accepted.balance(&f.client.address), 0);
    assert!(f.client.try_get_bounty(&1).is_err());

    // Topping up to exact minimum and retrying must still assign bounty_id == 1,
    // proving NextBountyId was not incremented on the failed transfer.
    mint_token(&f.env, &f.accepted_token, &f.maintainer, 1);
    let transfer_sub = MockAuthInvoke {
        contract: &f.accepted_token,
        fn_name: "transfer",
        args: (&f.maintainer, &f.client.address, &min_amount).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &min_amount,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[transfer_sub],
        },
    }]);
    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.accepted_token,
        &min_amount,
        &repo,
        &1,
        &title,
        &deadline,
        &0,
        &None,
    );
    assert_eq!(bounty_id, 1);
    assert_eq!(accepted.balance(&f.client.address), min_amount);
}

#[test]
fn failing_token_contract_after_validation_and_role_auth_precedence() {
    let f = setup();
    let min_amount = DEFAULT_MIN_BOUNTY_AMOUNT;
    let failing_token = f.env.register(FailingToken, ());

    // Allowlist the failing token so all bounty validations pass before transfer.
    f.env.mock_auths(&[MockAuth {
        address: &f.admin,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "add_allowed_token",
            args: (&f.admin, &failing_token).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    f.client.add_allowed_token(&f.admin, &failing_token);

    let repo = String::from_str(&f.env, "org/repo");
    let title = String::from_str(&f.env, "Failing token contract");
    let deadline = f.env.ledger().timestamp() + 1_000;

    // Signed contributor and arbiter fail at authorization before reaching token transfer.
    let auth_error = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
    for (role, signer) in [
        ("contributor", f.contributor.clone()),
        ("arbiter", f.arbiter.clone()),
    ] {
        f.env.mock_auths(&[MockAuth {
            address: &signer,
            invoke: &MockAuthInvoke {
                contract: &f.client.address,
                fn_name: "create_bounty",
                args: (
                    &f.maintainer,
                    &failing_token,
                    &min_amount,
                    &repo,
                    &1u32,
                    &title,
                    &deadline,
                    &0u32,
                    &None::<u64>,
                )
                    .into_val(&f.env),
                sub_invokes: &[],
            },
        }]);
        assert_eq!(
            f.client.try_create_bounty(
                &f.maintainer,
                &failing_token,
                &min_amount,
                &repo,
                &1,
                &title,
                &deadline,
                &0,
                &None,
            ),
            Err(Ok(auth_error)),
            "{role} must fail authorization before token transfer is attempted"
        );
    }

    // Signed maintainer passes validation and receives EscrowTransferFailed when transfer fails.
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &failing_token,
                &min_amount,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert_eq!(
        f.client.try_create_bounty(
            &f.maintainer,
            &failing_token,
            &min_amount,
            &repo,
            &1,
            &title,
            &deadline,
            &0,
            &None,
        ),
        Err(Ok(Error::from_contract_error(
            ContractError::EscrowTransferFailed as u32
        )))
    );
    assert!(f.client.try_get_bounty(&1).is_err());
}

#[test]
fn token_transfer_failure_with_existing_bounties_does_not_strand_or_multiply_funds_or_skip_ids() {
    let f = setup();
    let min_amount = DEFAULT_MIN_BOUNTY_AMOUNT;
    let repo = String::from_str(&f.env, "org/repo");
    let deadline = f.env.ledger().timestamp() + 1_000;

    // 1. Legitimate creation of Bounty 1 succeeds
    mint_token(&f.env, &f.accepted_token, &f.maintainer, min_amount);
    let transfer_sub_1 = MockAuthInvoke {
        contract: &f.accepted_token,
        fn_name: "transfer",
        args: (&f.maintainer, &f.client.address, &min_amount).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &min_amount,
                &repo,
                &101u32,
                &String::from_str(&f.env, "Bounty 1"),
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[transfer_sub_1],
        },
    }]);
    let bounty_1_id = f.client.create_bounty(
        &f.maintainer,
        &f.accepted_token,
        &min_amount,
        &repo,
        &101,
        &String::from_str(&f.env, "Bounty 1"),
        &deadline,
        &0,
        &None,
    );
    assert_eq!(bounty_1_id, 1);

    let accepted = TokenClient::new(&f.env, &f.accepted_token);
    assert_eq!(accepted.balance(&f.client.address), min_amount);
    assert_eq!(accepted.balance(&f.maintainer), 0);
    assert_eq!(f.client.get_bounty(&1).status, BountyStatus::Open);

    // 2. Attempt Bounty 2 with failing token transfer (maintainer has 1 stroop less than required)
    let bounty_2_amount = min_amount * 2;
    mint_token(&f.env, &f.accepted_token, &f.maintainer, bounty_2_amount - 1);

    let transfer_sub_2 = MockAuthInvoke {
        contract: &f.accepted_token,
        fn_name: "transfer",
        args: (&f.maintainer, &f.client.address, &bounty_2_amount).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &bounty_2_amount,
                &repo,
                &102u32,
                &String::from_str(&f.env, "Bounty 2"),
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[transfer_sub_2],
        },
    }]);

    assert_eq!(
        f.client.try_create_bounty(
            &f.maintainer,
            &f.accepted_token,
            &bounty_2_amount,
            &repo,
            &102,
            &String::from_str(&f.env, "Bounty 2"),
            &deadline,
            &0,
            &None,
        ),
        Err(Ok(Error::from_contract_error(
            ContractError::EscrowTransferFailed as u32
        )))
    );

    // Invariants:
    // Contract balance remains untouched (only Bounty 1 funds)
    assert_eq!(accepted.balance(&f.client.address), min_amount);
    // Maintainer balance retained completely (no partial deduction)
    assert_eq!(accepted.balance(&f.maintainer), bounty_2_amount - 1);
    // Bounty 1 unaffected
    assert_eq!(f.client.get_bounty(&1).status, BountyStatus::Open);
    // Bounty 2 not created
    assert!(f.client.try_get_bounty(&2).is_err());

    // 3. Top up 1 stroop and retry Bounty 2 -> succeeds with sequential ID 2
    mint_token(&f.env, &f.accepted_token, &f.maintainer, 1);
    let transfer_sub_retry = MockAuthInvoke {
        contract: &f.accepted_token,
        fn_name: "transfer",
        args: (&f.maintainer, &f.client.address, &bounty_2_amount).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &bounty_2_amount,
                &repo,
                &102u32,
                &String::from_str(&f.env, "Bounty 2"),
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[transfer_sub_retry],
        },
    }]);
    let bounty_2_id = f.client.create_bounty(
        &f.maintainer,
        &f.accepted_token,
        &bounty_2_amount,
        &repo,
        &102,
        &String::from_str(&f.env, "Bounty 2"),
        &deadline,
        &0,
        &None,
    );
    assert_eq!(bounty_2_id, 2);
    assert_eq!(accepted.balance(&f.client.address), min_amount + bounty_2_amount);
    assert_eq!(accepted.balance(&f.maintainer), 0);
    assert_eq!(f.client.get_bounty(&2).status, BountyStatus::Open);
}

#[test]
fn successful_funding_emits_exactly_one_canonical_escrow_event() {
    let f = setup();
    let min_amount = DEFAULT_MIN_BOUNTY_AMOUNT;
    mint_token(&f.env, &f.accepted_token, &f.maintainer, min_amount);

    let repo = String::from_str(&f.env, "org/repo");
    let title = String::from_str(&f.env, "Escrow event schema");
    let deadline = f.env.ledger().timestamp() + 1_000;

    let transfer_sub = MockAuthInvoke {
        contract: &f.accepted_token,
        fn_name: "transfer",
        args: (&f.maintainer, &f.client.address, &min_amount).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &min_amount,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[transfer_sub],
        },
    }]);

    let bounty_id = f.client.create_bounty(
        &f.maintainer,
        &f.accepted_token,
        &min_amount,
        &repo,
        &1,
        &title,
        &deadline,
        &0,
        &None,
    );
    assert_eq!(bounty_id, 1);

    let events = escrow_funding_events(&f.env, &f.client.address);
    assert_eq!(
        events.len(),
        1,
        "exactly one escrow funding event per successful create_bounty"
    );

    let event = events.get(0).unwrap();
    assert_eq!(
        event,
        EscrowFundingEvent {
            bounty_id,
            token: f.accepted_token.clone(),
            amount: min_amount,
            delta: min_amount,
            previous_remaining: 0,
            committed_remaining: min_amount,
            status: BountyStatus::Open,
        }
    );

    // The event must reflect the committed bounty state, not a transient one.
    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, event.status);
    assert_eq!(bounty.token, event.token);
    assert_eq!(bounty.amount, event.amount);
    assert_eq!(event.committed_remaining, event.previous_remaining + event.delta);
    assert_eq!(event.committed_remaining, bounty.amount);
}

#[test]
fn failed_funding_emits_no_escrow_event() {
    let f = setup();
    let min_amount = DEFAULT_MIN_BOUNTY_AMOUNT;
    // One stroop short so validation passes but the token transfer fails.
    mint_token(&f.env, &f.accepted_token, &f.maintainer, min_amount - 1);

    let repo = String::from_str(&f.env, "org/repo");
    let title = String::from_str(&f.env, "Escrow event on failure");
    let deadline = f.env.ledger().timestamp() + 1_000;

    let transfer_sub = MockAuthInvoke {
        contract: &f.accepted_token,
        fn_name: "transfer",
        args: (&f.maintainer, &f.client.address, &min_amount).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &f.accepted_token,
                &min_amount,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[transfer_sub],
        },
    }]);

    assert_eq!(
        f.client.try_create_bounty(
            &f.maintainer,
            &f.accepted_token,
            &min_amount,
            &repo,
            &1,
            &title,
            &deadline,
            &0,
            &None,
        ),
        Err(Ok(Error::from_contract_error(
            ContractError::EscrowTransferFailed as u32
        )))
    );

    assert_eq!(
        escrow_funding_events(&f.env, &f.client.address).len(),
        0,
        "no escrow funding event may be emitted when funding fails"
    );
    assert!(f.client.try_get_bounty(&1).is_err());
}

#[test]
fn failing_token_contract_emits_no_escrow_event() {
    let f = setup();
    let min_amount = DEFAULT_MIN_BOUNTY_AMOUNT;
    let failing_token = f.env.register(FailingToken, ());

    f.env.mock_auths(&[MockAuth {
        address: &f.admin,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "add_allowed_token",
            args: (&f.admin, &failing_token).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    f.client.add_allowed_token(&f.admin, &failing_token);

    let repo = String::from_str(&f.env, "org/repo");
    let title = String::from_str(&f.env, "Failing token escrow event");
    let deadline = f.env.ledger().timestamp() + 1_000;

    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "create_bounty",
            args: (
                &f.maintainer,
                &failing_token,
                &min_amount,
                &repo,
                &1u32,
                &title,
                &deadline,
                &0u32,
                &None::<u64>,
            )
                .into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert_eq!(
        f.client.try_create_bounty(
            &f.maintainer,
            &failing_token,
            &min_amount,
            &repo,
            &1,
            &title,
            &deadline,
            &0,
            &None,
        ),
        Err(Ok(Error::from_contract_error(
            ContractError::EscrowTransferFailed as u32
        )))
    );

    assert_eq!(
        escrow_funding_events(&f.env, &f.client.address).len(),
        0,
        "no escrow funding event may be emitted when the token transfer fails"
    );
    assert!(f.client.try_get_bounty(&1).is_err());
}

#[test]
fn escrow_events_are_ordered_and_reconstruct_committed_balance_per_bounty() {
    let f = setup();
    let min_amount = DEFAULT_MIN_BOUNTY_AMOUNT;
    let repo = String::from_str(&f.env, "org/repo");
    let deadline = f.env.ledger().timestamp() + 1_000;

    let first_amount = min_amount;
    let second_amount = min_amount * 2;
    mint_token(
        &f.env,
        &f.accepted_token,
        &f.maintainer,
        first_amount + second_amount,
    );

    let mut created = soroban_sdk::Vec::new(&f.env);
    for (index, amount) in [first_amount, second_amount].iter().enumerate() {
        let title = String::from_str(&f.env, "Ordered escrow");
        let transfer_sub = MockAuthInvoke {
            contract: &f.accepted_token,
            fn_name: "transfer",
            args: (&f.maintainer, &f.client.address, amount).into_val(&f.env),
            sub_invokes: &[],
        };
        f.env.mock_auths(&[MockAuth {
            address: &f.maintainer,
            invoke: &MockAuthInvoke {
                contract: &f.client.address,
                fn_name: "create_bounty",
                args: (
                    &f.maintainer,
                    &f.accepted_token,
                    amount,
                    &repo,
                    &(index as u32 + 1),
                    &title,
                    &deadline,
                    &0u32,
                    &None::<u64>,
                )
                    .into_val(&f.env),
                sub_invokes: &[transfer_sub],
            },
        }]);
        let bounty_id = f.client.create_bounty(
            &f.maintainer,
            &f.accepted_token,
            amount,
            &repo,
            &(index as u32 + 1),
            &title,
            &deadline,
            &0,
            &None,
        );
        created.push_back((bounty_id, *amount));
    }

    let events = escrow_funding_events(&f.env, &f.client.address);
    assert_eq!(events.len(), 2, "one event per successful funding");

    // Events are emitted in funding order and each carries its own bounty ID.
    let mut running_remaining: i128 = 0;
    for index in 0..created.len() {
        let (expected_id, expected_amount) = created.get(index).unwrap();
        let event = events.get(index).unwrap();
        assert_eq!(event.bounty_id, expected_id);
        assert_eq!(event.token, f.accepted_token);
        assert_eq!(event.amount, expected_amount);
        assert_eq!(event.delta, expected_amount);
        assert_eq!(event.previous_remaining, running_remaining);
        running_remaining += event.delta;
        assert_eq!(event.committed_remaining, running_remaining);
        assert_eq!(event.status, BountyStatus::Open);

        // Each event reflects the committed bounty state for its own ID.
        let bounty = f.client.get_bounty(&expected_id);
        assert_eq!(bounty.status, event.status);
        assert_eq!(bounty.amount, event.amount);
    }

    let accepted = TokenClient::new(&f.env, &f.accepted_token);
    assert_eq!(accepted.balance(&f.client.address), running_remaining);
}
