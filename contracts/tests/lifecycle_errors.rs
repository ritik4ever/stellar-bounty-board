//! Stable wire errors for the six escrow lifecycle entry points (issue #1162).
use soroban_sdk::{
    contracttype,
    testutils::{Address as _, Ledger},
    token,
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, InvokeError, String, TryFromVal, Val,
};
use stellar_bounty_board::{
    Bounty, BountyStatus, ContractError, StellarBountyBoardContract,
    StellarBountyBoardContractClient, MAX_BOUNTY_AMOUNT, MAX_DISPUTE_WINDOW_OVERRIDE,
    MIN_DISPUTE_WINDOW_OVERRIDE,
};

// Same encoded storage keys as the contract, used only to exercise invalid
// legacy/corrupt storage and exhausted IDs without exposing a production setter.
#[contracttype]
#[derive(Clone)]
enum Key {
    Bounty(u64),
    NextBountyId,
    FeeRecipient,
    Arbiter,
}

type CreateResult =
    Result<Result<u64, <u64 as TryFromVal<Env, Val>>::Error>, Result<Error, InvokeError>>;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    admin: Address,
    maintainer: Address,
    contributor: Address,
    arbiter: Address,
    fee_recipient: Address,
    token: Address,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(100);
        let id = env.register(StellarBountyBoardContract, ());
        let client = StellarBountyBoardContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let maintainer = Address::generate(&env);
        let contributor = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let fee_recipient = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(Address::generate(&env));
        asset
            .issuer()
            .set_flag(soroban_sdk::testutils::IssuerFlags::RevocableFlag);
        let token = asset.address();
        token::StellarAssetClient::new(&env, &token).mint(&maintainer, &1_000_000);
        client.initialize(&admin, &fee_recipient, &arbiter, &600);
        Self {
            env,
            client,
            admin,
            maintainer,
            contributor,
            arbiter,
            fee_recipient,
            token,
        }
    }

    fn try_create(
        &self,
        amount: i128,
        deadline: u64,
        fee: u32,
        window: Option<u64>,
    ) -> CreateResult {
        self.client.try_create_bounty(
            &self.maintainer,
            &self.token,
            &amount,
            &String::from_str(&self.env, "repo"),
            &1,
            &String::from_str(&self.env, "title"),
            &deadline,
            &fee,
            &window,
        )
    }

    fn funded(&self, fee: u32) -> u64 {
        self.try_create(1_000, 1_000, fee, None).unwrap().unwrap()
    }

    fn submitted(&self, fee: u32) -> u64 {
        let id = self.funded(fee);
        self.client.reserve_bounty(&id, &self.contributor);
        self.client.submit_bounty(&id, &self.contributor);
        id
    }

    fn stored(&self, id: u64) -> Bounty {
        self.env.as_contract(&self.client.address, || {
            self.env
                .storage()
                .persistent()
                .get(&Key::Bounty(id))
                .unwrap()
        })
    }

    fn mutate(&self, id: u64, change: impl FnOnce(&mut Bounty)) {
        let mut bounty = self.stored(id);
        change(&mut bounty);
        self.env.as_contract(&self.client.address, || {
            self.env
                .storage()
                .persistent()
                .set(&Key::Bounty(id), &bounty);
        });
    }

    fn remove(&self, key: Key) {
        self.env.as_contract(&self.client.address, || {
            self.env.storage().persistent().remove(&key);
        });
    }

    fn balances(&self) -> [i128; 4] {
        let token = token::Client::new(&self.env, &self.token);
        [
            token.balance(&self.maintainer),
            token.balance(&self.client.address),
            token.balance(&self.contributor),
            token.balance(&self.fee_recipient),
        ]
    }
}

fn assert_error<T, E>(
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

#[test]
fn lifecycle_error_codes_are_stable_unique_and_round_trip() {
    let codes = [
        (ContractError::BountyNotOpen, 1),
        (ContractError::BountyNotFound, 2),
        (ContractError::BountyAlreadyReserved, 3),
        (ContractError::AlreadyInitialized, 4),
        (ContractError::NotInitialized, 5),
        (ContractError::NotAdmin, 6),
        (ContractError::NotArbiter, 7),
        (ContractError::ArbiterNotSet, 8),
        (ContractError::NoPendingArbiter, 9),
        (ContractError::TimelockNotElapsed, 10),
        (ContractError::InvalidAmount, 11),
        (ContractError::AmountTooSmall, 12),
        (ContractError::DeadlineMustBeInTheFuture, 13),
        (ContractError::DeadlineMustAdvance, 14),
        (ContractError::FeeRecipientNotSet, 15),
        (ContractError::TokenNotAllowed, 16),
        (ContractError::DisputeWindowOverrideTooSmall, 17),
        (ContractError::DisputeWindowOverrideTooLarge, 18),
        (ContractError::BountyMustBeReserved, 19),
        (ContractError::BountyMustBeSubmitted, 20),
        (ContractError::BountyNotExpiredYet, 21),
        (ContractError::BountyExpired, 22),
        (ContractError::BountyAlreadyFinalized, 23),
        (ContractError::CannotExtendFinalizedBounty, 24),
        (ContractError::MaintainerMismatch, 25),
        (ContractError::ContributorMismatch, 26),
        (ContractError::MissingContributor, 27),
        (ContractError::DisputeWindowNotMet, 28),
        (ContractError::ContractIsPaused, 29),
        (ContractError::InsufficientArbiterStake, 30),
        (ContractError::StakeTokenMismatch, 31),
        (ContractError::NoArbiterStake, 32),
        (ContractError::SlashExceedsStake, 33),
        (ContractError::NotCommitteeMember, 34),
        (ContractError::DuplicateCommitteeVote, 35),
        (ContractError::CommitteeSizeExceeded, 36),
        (ContractError::DuplicateCommitteeMember, 37),
        (ContractError::CommitteeNotConfigured, 38),
        (ContractError::InvalidFeeBps, 39),
        (ContractError::BountyIdOverflow, 40),
        (ContractError::BountyMustBeDisputed, 41),
        (ContractError::EscrowTransferFailed, 42),
        (ContractError::PayoutTransferFailed, 43),
        (ContractError::FeeTransferFailed, 44),
        (ContractError::RefundTransferFailed, 45),
    ];
    let mut seen = std::collections::BTreeSet::new();
    for (variant, code) in codes {
        assert!(seen.insert(code), "duplicate error code");
        assert_eq!(variant as u32, code);
        assert_eq!(
            ContractError::try_from(Error::from_contract_error(code)),
            Ok(variant)
        );
    }
    assert!(ContractError::try_from(Error::from_contract_error(0)).is_err());
    assert!(ContractError::try_from(Error::from_contract_error(46)).is_err());
}

#[test]
fn lifecycle_create_reports_each_validation_guard() {
    let f = Fixture::new();
    let original = f.balances();
    for amount in [-1, 0, MAX_BOUNTY_AMOUNT + 1] {
        assert_error(
            f.try_create(amount, 1_000, 0, None),
            ContractError::InvalidAmount,
        );
    }
    assert_error(
        f.try_create(99, 1_000, 0, None),
        ContractError::AmountTooSmall,
    );
    for deadline in [0, 99, 100] {
        assert_error(
            f.try_create(1_000, deadline, 0, None),
            ContractError::DeadlineMustBeInTheFuture,
        );
    }
    assert_error(
        f.try_create(1_000, 1_000, 10_001, None),
        ContractError::InvalidFeeBps,
    );
    assert_error(
        f.try_create(1_000, 1_000, 0, Some(MIN_DISPUTE_WINDOW_OVERRIDE - 1)),
        ContractError::DisputeWindowOverrideTooSmall,
    );
    assert_error(
        f.try_create(1_000, 1_000, 0, Some(MAX_DISPUTE_WINDOW_OVERRIDE + 1)),
        ContractError::DisputeWindowOverrideTooLarge,
    );
    assert_eq!(f.balances(), original);
    assert_error(f.client.try_get_bounty(&1), ContractError::BountyNotFound);
    assert_eq!(f.funded(0), 1, "rejected creates must not consume IDs");

    let f = Fixture::new();
    f.client.pause();
    assert_error(
        f.try_create(1_000, 1_000, 0, None),
        ContractError::ContractIsPaused,
    );
    let f = Fixture::new();
    f.remove(Key::FeeRecipient);
    assert_error(
        f.try_create(1_000, 1_000, 1, None),
        ContractError::FeeRecipientNotSet,
    );
    let f = Fixture::new();
    f.client.set_allowlist_enabled(&f.admin, &true);
    assert_error(
        f.try_create(1_000, 1_000, 0, None),
        ContractError::TokenNotAllowed,
    );
}

#[test]
fn lifecycle_id_exhaustion_is_named_and_rolls_back_escrow() {
    let f = Fixture::new();
    f.env.as_contract(&f.client.address, || {
        f.env
            .storage()
            .persistent()
            .set(&Key::NextBountyId, &u64::MAX);
    });
    let original = f.balances();
    assert_error(
        f.try_create(1_000, 1_000, 0, None),
        ContractError::BountyIdOverflow,
    );
    assert_eq!(f.balances(), original);
    assert_error(
        f.client.try_get_bounty(&u64::MAX),
        ContractError::BountyNotFound,
    );
}

#[test]
fn lifecycle_unknown_ids_have_the_same_not_found_code() {
    let f = Fixture::new();
    assert_error(
        f.client.try_reserve_bounty(&999, &f.contributor),
        ContractError::BountyNotFound,
    );
    assert_error(
        f.client.try_submit_bounty(&999, &f.contributor),
        ContractError::BountyNotFound,
    );
    assert_error(
        f.client.try_release_bounty(&999, &f.maintainer),
        ContractError::BountyNotFound,
    );
    assert_error(
        f.client.try_refund_bounty(&999, &f.maintainer),
        ContractError::BountyNotFound,
    );
    assert_error(
        f.client.try_dispute_bounty(&999, &f.arbiter),
        ContractError::BountyNotFound,
    );
}

#[test]
fn lifecycle_reserve_distinguishes_paused_reserved_expired_and_other_states() {
    let f = Fixture::new();
    let id = f.funded(0);
    f.client.pause();
    assert_error(
        f.client.try_reserve_bounty(&id, &f.contributor),
        ContractError::ContractIsPaused,
    );
    f.client.unpause();
    f.client.reserve_bounty(&id, &f.contributor);
    assert_error(
        f.client.try_reserve_bounty(&id, &f.contributor),
        ContractError::BountyAlreadyReserved,
    );
    assert_error(
        f.client.try_reserve_bounty(&id, &Address::generate(&f.env)),
        ContractError::BountyAlreadyReserved,
    );
    f.client.submit_bounty(&id, &f.contributor);
    assert_error(
        f.client.try_reserve_bounty(&id, &f.contributor),
        ContractError::BountyNotOpen,
    );
    let id = f.funded(0);
    f.env.ledger().set_timestamp(1_001);
    assert_error(
        f.client.try_reserve_bounty(&id, &f.contributor),
        ContractError::BountyExpired,
    );
    assert_eq!(f.stored(id).status, BountyStatus::Open);
}

#[test]
fn lifecycle_submit_distinguishes_state_expiry_missing_and_wrong_contributor() {
    let f = Fixture::new();
    let id = f.funded(0);
    assert_error(
        f.client.try_submit_bounty(&id, &f.contributor),
        ContractError::BountyMustBeReserved,
    );
    f.client.reserve_bounty(&id, &f.contributor);
    assert_error(
        f.client.try_submit_bounty(&id, &Address::generate(&f.env)),
        ContractError::ContributorMismatch,
    );
    f.mutate(id, |b| b.contributor = None);
    assert_error(
        f.client.try_submit_bounty(&id, &f.contributor),
        ContractError::MissingContributor,
    );
    f.mutate(id, |b| b.contributor = Some(f.contributor.clone()));
    f.env.ledger().set_timestamp(1_001);
    assert_error(
        f.client.try_submit_bounty(&id, &f.contributor),
        ContractError::BountyExpired,
    );
    assert_eq!(f.stored(id).status, BountyStatus::Reserved);
}

#[test]
fn lifecycle_release_distinguishes_maintainer_state_and_missing_storage() {
    let f = Fixture::new();
    let id = f.funded(100);
    assert_error(
        f.client.try_release_bounty(&id, &Address::generate(&f.env)),
        ContractError::MaintainerMismatch,
    );
    assert_error(
        f.client.try_release_bounty(&id, &f.maintainer),
        ContractError::BountyMustBeSubmitted,
    );
    f.client.reserve_bounty(&id, &f.contributor);
    f.client.submit_bounty(&id, &f.contributor);
    f.mutate(id, |b| b.contributor = None);
    assert_error(
        f.client.try_release_bounty(&id, &f.maintainer),
        ContractError::MissingContributor,
    );
    f.mutate(id, |b| b.contributor = Some(f.contributor.clone()));
    f.remove(Key::FeeRecipient);
    let original = f.balances();
    assert_error(
        f.client.try_release_bounty(&id, &f.maintainer),
        ContractError::FeeRecipientNotSet,
    );
    assert_eq!(
        f.balances(),
        original,
        "a paid-out net amount must roll back when fee setup is missing"
    );
    assert_eq!(f.stored(id).status, BountyStatus::Submitted);
}

#[test]
fn lifecycle_refund_distinguishes_maintainer_deadline_and_finalization() {
    let f = Fixture::new();
    let id = f.funded(0);
    assert_error(
        f.client.try_refund_bounty(&id, &Address::generate(&f.env)),
        ContractError::MaintainerMismatch,
    );
    for now in [100, 1_000] {
        f.env.ledger().set_timestamp(now);
        assert_error(
            f.client.try_refund_bounty(&id, &f.maintainer),
            ContractError::BountyNotExpiredYet,
        );
    }
    f.env.ledger().set_timestamp(1_001);
    f.client.refund_bounty(&id, &f.maintainer);
    assert_error(
        f.client.try_refund_bounty(&id, &f.maintainer),
        ContractError::BountyAlreadyFinalized,
    );
    let f = Fixture::new();
    let id = f.submitted(0);
    f.client.release_bounty(&id, &f.maintainer);
    assert_error(
        f.client.try_refund_bounty(&id, &f.maintainer),
        ContractError::BountyAlreadyFinalized,
    );
}

#[test]
fn lifecycle_dispute_distinguishes_each_guard_and_keeps_contributor_auth() {
    let f = Fixture::new();
    let id = f.funded(0);
    assert_error(
        f.client.try_dispute_bounty(&id, &f.arbiter),
        ContractError::MissingContributor,
    );
    f.client.reserve_bounty(&id, &f.contributor);
    assert_error(
        f.client.try_dispute_bounty(&id, &f.arbiter),
        ContractError::BountyMustBeSubmitted,
    );
    f.client.submit_bounty(&id, &f.contributor);
    assert_error(
        f.client.try_dispute_bounty(&id, &Address::generate(&f.env)),
        ContractError::NotArbiter,
    );
    f.remove(Key::Arbiter);
    assert_error(
        f.client.try_dispute_bounty(&id, &f.arbiter),
        ContractError::ArbiterNotSet,
    );
    f.env.ledger().set_timestamp(1_001);
    assert_error(
        f.client.try_dispute_bounty(&id, &f.arbiter),
        ContractError::BountyExpired,
    );
    let f = Fixture::new();
    let id = f.funded(0);
    assert_error(
        f.client.try_resolve_dispute(&id, &true),
        ContractError::BountyMustBeDisputed,
    );
}

#[test]
fn lifecycle_token_failures_are_operation_specific_and_atomic() {
    // Actual Stellar asset contracts reject transfers to deauthorized addresses.
    // Their codes must not leak as an unrelated validation code on this contract.
    let f = Fixture::new();
    token::StellarAssetClient::new(&f.env, &f.token).set_authorized(&f.maintainer, &false);
    let original = f.balances();
    assert_error(
        f.try_create(1_000, 1_000, 0, None),
        ContractError::EscrowTransferFailed,
    );
    assert_eq!(f.balances(), original);
    assert_error(f.client.try_get_bounty(&1), ContractError::BountyNotFound);
    token::StellarAssetClient::new(&f.env, &f.token).set_authorized(&f.maintainer, &true);
    assert_eq!(f.funded(0), 1);

    for fee_fails in [false, true] {
        let f = Fixture::new();
        let id = f.submitted(100);
        let recipient = if fee_fails {
            &f.fee_recipient
        } else {
            &f.contributor
        };
        token::StellarAssetClient::new(&f.env, &f.token).set_authorized(recipient, &false);
        let original = f.balances();
        let error = if fee_fails {
            ContractError::FeeTransferFailed
        } else {
            ContractError::PayoutTransferFailed
        };
        assert_error(f.client.try_release_bounty(&id, &f.maintainer), error);
        assert_eq!(f.balances(), original);
        assert_eq!(f.stored(id).status, BountyStatus::Submitted);
        token::StellarAssetClient::new(&f.env, &f.token).set_authorized(recipient, &true);
        f.client.release_bounty(&id, &f.maintainer);
        assert_eq!(f.stored(id).status, BountyStatus::Released);
    }

    let f = Fixture::new();
    let id = f.funded(0);
    f.env.ledger().set_timestamp(1_001);
    token::StellarAssetClient::new(&f.env, &f.token).set_authorized(&f.maintainer, &false);
    let original = f.balances();
    assert_error(
        f.client.try_refund_bounty(&id, &f.maintainer),
        ContractError::RefundTransferFailed,
    );
    assert_eq!(f.balances(), original);
    assert_eq!(f.stored(id).status, BountyStatus::Open);
}

#[test]
fn lifecycle_missing_signatures_remain_host_authorization_errors() {
    for action in [
        "create", "reserve", "submit", "release", "refund", "dispute",
    ] {
        let f = Fixture::new();
        let id = f.submitted(0);
        f.env.mock_auths(&[]);
        let expected = Error::from((ScErrorType::Context, ScErrorCode::InvalidAction));
        if action == "create" {
            assert_eq!(f.try_create(1_000, 1_000, 0, None), Err(Ok(expected)));
        } else {
            let result = match action {
                "reserve" => f.client.try_reserve_bounty(&id, &f.contributor),
                "submit" => f.client.try_submit_bounty(&id, &f.contributor),
                "release" => f.client.try_release_bounty(&id, &f.maintainer),
                "refund" => f.client.try_refund_bounty(&id, &f.maintainer),
                _ => f.client.try_dispute_bounty(&id, &f.arbiter),
            };
            assert_eq!(
                result,
                Err(Ok(expected)),
                "{action} must require its stored actor's signature"
            );
        }
        assert_eq!(f.stored(id).status, BountyStatus::Submitted);
    }
}
