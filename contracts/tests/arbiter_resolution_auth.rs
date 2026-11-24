//! Regression coverage for authority over arbiter dispute resolution.
//!
//! Settling a disputed bounty moves escrowed funds, so every resolution path
//! must be tied to the stored arbiter (or a registered committee member) and
//! the paths must be mutually exclusive:
//!
//! * The arbiter may choose either destination (`release` or `refund`) through
//!   [`StellarBountyBoardContract::resolve_dispute`] or schedule one through
//!   [`StellarBountyBoardContract::propose_resolution`].
//! * The maintainer, contributor, admin, and unrelated outsiders cannot settle
//!   or schedule a conflicting ruling, and their attempts leave balances and
//!   bounty status untouched.
//! * A settlement through one path clears any ruling scheduled through another,
//!   so the shared escrow can never be paid out twice.
//! * An appeal may only be filed by the party that loses the scheduled ruling.

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    vec,
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, FromVal, IntoVal, Symbol,
};
use stellar_bounty_board::{
    BountyResolved, BountyStatus, ContractError, StellarBountyBoardContract,
    StellarBountyBoardContractClient,
};

const DISPUTE_WINDOW: u64 = 60;
const AMOUNT: i128 = 1_000;
const FEE_BPS: u32 = 250;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    admin: Address,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
    outsider: Address,
    fee_recipient: Address,
    token: Address,
}

impl Fixture {
    /// Builds a disputed bounty and advances past its dispute window so the
    /// arbiter is allowed to settle it.
    fn disputed(env: Env) -> (Self, u64) {
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);

        let contract = env.register(StellarBountyBoardContract, ());
        let client = StellarBountyBoardContractClient::new(&env, &contract);
        let admin = Address::generate(&env);
        let maintainer = Address::generate(&env);
        let contributor = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let outsider = Address::generate(&env);
        let fee_recipient = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        StellarAssetClient::new(&env, &token).mint(&maintainer, &AMOUNT);

        client.initialize(&admin, &fee_recipient, &arbiter, &DISPUTE_WINDOW);
        let bounty_id = client.create_bounty(
            &maintainer,
            &token,
            &AMOUNT,
            &soroban_sdk::String::from_str(&env, "test/repo"),
            &7,
            &soroban_sdk::String::from_str(&env, "Arbiter authority"),
            &(env.ledger().timestamp() + 10_000),
            &FEE_BPS,
            &None,
        );
        client.reserve_bounty(&bounty_id, &contributor);
        client.submit_bounty(&bounty_id, &contributor);
        client.dispute_bounty(&bounty_id, &arbiter);

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + DISPUTE_WINDOW + 1);

        let fixture = Self {
            env,
            client,
            admin,
            maintainer,
            contributor,
            arbiter,
            outsider,
            fee_recipient,
            token,
        };
        (fixture, bounty_id)
    }

    fn balances(&self) -> [i128; 4] {
        let token = TokenClient::new(&self.env, &self.token);
        [
            token.balance(&self.maintainer),
            token.balance(&self.client.address),
            token.balance(&self.contributor),
            token.balance(&self.fee_recipient),
        ]
    }
}

fn auth_error() -> Error {
    Error::from((ScErrorType::Context, ScErrorCode::InvalidAction))
}

fn resolve_invoke<'c>(
    env: &Env,
    client: &'c StellarBountyBoardContractClient<'static>,
    id: u64,
    release: bool,
) -> MockAuthInvoke<'c> {
    MockAuthInvoke {
        contract: &client.address,
        fn_name: "resolve_dispute",
        args: (id, release).into_val(env),
        sub_invokes: &[],
    }
}

fn propose_invoke<'c>(
    env: &Env,
    client: &'c StellarBountyBoardContractClient<'static>,
    id: u64,
    decision: u32,
) -> MockAuthInvoke<'c> {
    MockAuthInvoke {
        contract: &client.address,
        fn_name: "propose_resolution",
        args: (id, decision).into_val(env),
        sub_invokes: &[],
    }
}

fn assert_single_resolution_event(f: &Fixture, bounty_id: u64, release: bool) {
    let events = f.env.events().all().filter_by_contract(&f.client.address);
    let resolved = events
        .events()
        .last()
        .expect("BountyResolved event should be emitted");

    let soroban_sdk::xdr::ContractEventBody::V0(body) = &resolved.body;
    assert_eq!(
        Symbol::from_val(&f.env, &body.topics[0]),
        symbol_short!("Bounty")
    );
    assert_eq!(
        Symbol::from_val(&f.env, &body.topics[1]),
        symbol_short!("Reslv")
    );
    assert_eq!(
        BountyResolved::from_val(&f.env, &body.data),
        BountyResolved {
            bounty_id,
            arbiter: f.arbiter.clone(),
            release,
            amount: AMOUNT,
        }
    );
}

// ─── Authorized arbiter settlement ───────────────────────────────────────────

#[test]
fn arbiter_can_release_escrow_to_the_contributor() {
    let (f, bounty_id) = Fixture::disputed(Env::default());

    f.env.mock_auths(&[MockAuth {
        address: &f.arbiter,
        invoke: &resolve_invoke(&f.env, &f.client, bounty_id, true),
    }]);
    f.client.resolve_dispute(&bounty_id, &true);

    // Events are only retained for the most recent invocation, so inspect them
    // before any further read call.
    assert_single_resolution_event(&f, bounty_id, true);

    let fee = AMOUNT * FEE_BPS as i128 / 10_000;
    assert_eq!(
        f.balances(),
        [AMOUNT - AMOUNT, 0, AMOUNT - fee, fee],
        "net escrow pays the contributor and the protocol fee pays the recipient"
    );
    assert_eq!(
        f.client.get_bounty(&bounty_id).status,
        BountyStatus::Released
    );
}

#[test]
fn arbiter_can_refund_escrow_to_the_maintainer() {
    let (f, bounty_id) = Fixture::disputed(Env::default());

    f.env.mock_auths(&[MockAuth {
        address: &f.arbiter,
        invoke: &resolve_invoke(&f.env, &f.client, bounty_id, false),
    }]);
    f.client.resolve_dispute(&bounty_id, &false);

    assert_single_resolution_event(&f, bounty_id, false);

    assert_eq!(
        f.balances(),
        [AMOUNT, 0, 0, 0],
        "a refund returns the full escrow to the maintainer and charges no fee"
    );
    assert_eq!(
        f.client.get_bounty(&bounty_id).status,
        BountyStatus::Refunded
    );
}

// ─── Unauthorized callers cannot settle or schedule ──────────────────────────

#[test]
fn only_the_arbiter_can_settle_a_dispute() {
    for role in ["maintainer", "contributor", "admin", "outsider"] {
        let (f, bounty_id) = Fixture::disputed(Env::default());
        let signer = match role {
            "maintainer" => f.maintainer.clone(),
            "contributor" => f.contributor.clone(),
            "admin" => f.admin.clone(),
            _ => f.outsider.clone(),
        };
        let before = f.balances();

        f.env.mock_auths(&[MockAuth {
            address: &signer,
            invoke: &resolve_invoke(&f.env, &f.client, bounty_id, true),
        }]);
        assert_eq!(
            f.client.try_resolve_dispute(&bounty_id, &true),
            Err(Ok(auth_error())),
            "{role} must not be able to settle a dispute"
        );

        assert_eq!(f.balances(), before, "{role} attempt must not move funds");
        let bounty = f.client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Disputed);
        assert!(bounty.contributor.is_some());
    }
}

#[test]
fn unsigned_settlement_is_rejected_without_moving_funds() {
    let (f, bounty_id) = Fixture::disputed(Env::default());
    let before = f.balances();

    f.env.mock_auths(&[]);
    assert_eq!(
        f.client.try_resolve_dispute(&bounty_id, &true),
        Err(Ok(auth_error())),
        "a missing arbiter signature must not release escrow"
    );

    assert_eq!(f.balances(), before);
    assert_eq!(
        f.client.get_bounty(&bounty_id).status,
        BountyStatus::Disputed
    );
}

#[test]
fn non_arbiter_cannot_schedule_a_conflicting_resolution() {
    for role in ["maintainer", "contributor", "admin", "outsider"] {
        let (f, bounty_id) = Fixture::disputed(Env::default());
        let signer = match role {
            "maintainer" => f.maintainer.clone(),
            "contributor" => f.contributor.clone(),
            "admin" => f.admin.clone(),
            _ => f.outsider.clone(),
        };

        f.env.mock_auths(&[MockAuth {
            address: &signer,
            invoke: &propose_invoke(&f.env, &f.client, bounty_id, 0),
        }]);
        assert_eq!(
            f.client.try_propose_resolution(&bounty_id, &0),
            Err(Ok(auth_error())),
            "{role} must not be able to schedule a ruling"
        );

        // No ruling was stored, so the status is unchanged and nothing can
        // later be paid out from the rejected invocation.
        assert_eq!(
            f.client.get_bounty(&bounty_id).status,
            BountyStatus::Disputed
        );
    }
}

#[test]
fn arbiter_cannot_schedule_a_ruling_for_a_settled_bounty() {
    let (f, bounty_id) = Fixture::disputed(Env::default());
    f.client.resolve_dispute(&bounty_id, &false);

    f.env.mock_auths(&[MockAuth {
        address: &f.arbiter,
        invoke: &propose_invoke(&f.env, &f.client, bounty_id, 0),
    }]);
    assert_eq!(
        f.client.try_propose_resolution(&bounty_id, &0),
        Err(Ok(Error::from(ContractError::BountyMustBeDisputed))),
        "a judgment may only target a bounty that is under dispute"
    );
}

// ─── Resolution paths are mutually exclusive ─────────────────────────────────

#[test]
fn direct_settlement_supersedes_a_scheduled_ruling() {
    let (f, bounty_id) = Fixture::disputed(Env::default());

    f.env.mock_auths(&[MockAuth {
        address: &f.arbiter,
        invoke: &propose_invoke(&f.env, &f.client, bounty_id, 0),
    }]);
    f.client.propose_resolution(&bounty_id, &0);

    // The arbiter later settles the same dispute directly in the other
    // direction. The scheduled payout must be dropped, not left armed.
    f.env.mock_auths(&[MockAuth {
        address: &f.arbiter,
        invoke: &resolve_invoke(&f.env, &f.client, bounty_id, false),
    }]);
    f.client.resolve_dispute(&bounty_id, &false);

    f.env
        .ledger()
        .set_timestamp(f.env.ledger().timestamp() + DISPUTE_WINDOW * 3);
    assert!(
        f.client.try_finalize_resolution(&bounty_id).is_err(),
        "a superseded ruling must not execute"
    );

    assert_eq!(f.balances(), [AMOUNT, 0, 0, 0]);
    assert_eq!(
        f.client.get_bounty(&bounty_id).status,
        BountyStatus::Refunded
    );
}

#[test]
fn committee_quorum_supersedes_a_scheduled_ruling() {
    let (f, bounty_id) = Fixture::disputed(Env::default());
    let committee_member = Address::generate(&f.env);
    let second_member = Address::generate(&f.env);

    f.env.mock_auths(&[MockAuth {
        address: &f.admin,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "set_arbiter_committee",
            args: (vec![
                &f.env,
                committee_member.clone(),
                second_member.clone(),
            ],)
                .into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    f.client.set_arbiter_committee(&vec![
        &f.env,
        committee_member.clone(),
        second_member.clone(),
    ]);

    f.env.mock_auths(&[MockAuth {
        address: &f.arbiter,
        invoke: &propose_invoke(&f.env, &f.client, bounty_id, 0),
    }]);
    f.client.propose_resolution(&bounty_id, &0);

    for (member, decision) in [(&committee_member, false), (&second_member, false)] {
        let vote = MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "vote_resolve_dispute",
            args: (bounty_id, member.clone(), decision).into_val(&f.env),
            sub_invokes: &[],
        };
        f.env.mock_auths(&[MockAuth {
            address: member,
            invoke: &vote,
        }]);
        f.client.vote_resolve_dispute(&bounty_id, member, &decision);
    }

    f.env
        .ledger()
        .set_timestamp(f.env.ledger().timestamp() + DISPUTE_WINDOW * 3);
    assert!(
        f.client.try_finalize_resolution(&bounty_id).is_err(),
        "a committee ruling must clear the scheduled arbiter payout"
    );

    assert_eq!(f.balances(), [AMOUNT, 0, 0, 0]);
    assert_eq!(
        f.client.get_bounty(&bounty_id).status,
        BountyStatus::Refunded
    );
}

// ─── Appeal authority ────────────────────────────────────────────────────────

#[test]
fn only_the_losing_party_can_appeal_a_scheduled_ruling() {
    let (f, bounty_id) = Fixture::disputed(Env::default());
    f.client.init(&100);

    f.env.mock_auths(&[MockAuth {
        address: &f.arbiter,
        invoke: &propose_invoke(&f.env, &f.client, bounty_id, 0),
    }]);
    f.client.propose_resolution(&bounty_id, &0);

    // A release ruling is lost by the maintainer; the winning contributor
    // cannot appeal it.
    f.env.mock_auths(&[MockAuth {
        address: &f.contributor,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "appeal",
            args: (bounty_id,).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert_eq!(
        f.client.try_appeal(&bounty_id),
        Err(Ok(auth_error())),
        "the winning party must not appeal"
    );

    f.env.mock_auths(&[MockAuth {
        address: &f.maintainer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "appeal",
            args: (bounty_id,).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    f.client.appeal(&bounty_id);

    f.env
        .ledger()
        .set_timestamp(f.env.ledger().timestamp() + 101);
    assert!(
        f.client.try_finalize_resolution(&bounty_id).is_err(),
        "an appealed ruling must not be finalized"
    );
}
