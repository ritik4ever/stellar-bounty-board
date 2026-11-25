//! Asset/unit boundaries for #1910. All balances are local Soroban test state.
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    testutils::{Address as _, Events as _, Ledger},
    token::Client as TokenClient,
    xdr::ContractEventBody,
    Address, Env, FromVal, Map, String, Symbol, TryFromVal, Val,
};
use stellar_bounty_board::{
    BountyStatus, StellarBountyBoardContract, StellarBountyBoardContractClient,
};

// SAC fixtures always report seven decimals. This minimal test-only token
// implements the transfer/balance/metadata surface with real configurable precision.
#[contract]
struct PrecisionToken;

#[contracttype]
#[derive(Clone)]
enum Key {
    Decimals,
    Balance(Address),
}

#[contractimpl]
impl PrecisionToken {
    pub fn __constructor(env: Env, decimals: u32, holder: Address, amount: i128) {
        env.storage().instance().set(&Key::Decimals, &decimals);
        env.storage()
            .persistent()
            .set(&Key::Balance(holder), &amount);
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&Key::Decimals).unwrap()
    }

    pub fn balance(env: Env, owner: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&Key::Balance(owner))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        assert!(amount >= 0);
        let available = Self::balance(env.clone(), from.clone());
        assert!(available >= amount, "insufficient token balance");
        if from == to {
            return;
        }
        let received = Self::balance(env.clone(), to.clone())
            .checked_add(amount)
            .unwrap();
        env.storage()
            .persistent()
            .set(&Key::Balance(from), &(available - amount));
        env.storage().persistent().set(&Key::Balance(to), &received);
    }
}

const MINTED: i128 = 100_000_000;
const AMOUNTS: [i128; 2] = [12_345_671, 1_234_567];

struct Fixture {
    env: Env,
    board: Address,
    maintainer: Address,
    contributor: Address,
    fee_recipient: Address,
    tokens: [Address; 2],
}

impl Fixture {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        let board = env.register(StellarBountyBoardContract, ());
        let admin = Address::generate(&env);
        let maintainer = Address::generate(&env);
        let contributor = Address::generate(&env);
        let fee_recipient = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let tokens = [
            env.register(PrecisionToken, (7u32, maintainer.clone(), MINTED)),
            env.register(PrecisionToken, (6u32, maintainer.clone(), MINTED)),
        ];
        let client = StellarBountyBoardContractClient::new(&env, &board);
        client.initialize(&admin, &fee_recipient, &arbiter, &600);
        client.set_allowlist_enabled(&admin, &true);
        for (i, token) in tokens.iter().enumerate() {
            client.add_allowed_token(&admin, token);
            assert_eq!(TokenClient::new(&env, token).decimals(), [7, 6][i]);
        }
        Self {
            env,
            board,
            maintainer,
            contributor,
            fee_recipient,
            tokens,
        }
    }

    fn client(&self) -> StellarBountyBoardContractClient<'_> {
        StellarBountyBoardContractClient::new(&self.env, &self.board)
    }

    fn fund(&self, token: usize, amount: i128, fee: u32) -> u64 {
        self.client().create_bounty(
            &self.maintainer,
            &self.tokens[token],
            &amount,
            &String::from_str(&self.env, "org/repo"),
            &1910,
            &String::from_str(&self.env, "asset units"),
            &2_000,
            &fee,
            &None,
        )
    }

    fn balances(&self, token: usize) -> [i128; 4] {
        let client = TokenClient::new(&self.env, &self.tokens[token]);
        [
            &self.maintainer,
            &self.board,
            &self.contributor,
            &self.fee_recipient,
        ]
        .map(|owner| client.balance(owner))
    }

    fn assert_change(&self, id: u64, token: usize, delta: i128, previous: i128, remaining: i128) {
        let events = self.env.events().all().filter_by_contract(&self.board);
        let mut changes = std::vec::Vec::new();
        for event in events.events() {
            let ContractEventBody::V0(body) = &event.body;
            if body.topics.len() == 2
                && Symbol::from_val(&self.env, &body.topics[0]) == symbol_short!("Escrow")
                && Symbol::from_val(&self.env, &body.topics[1]) == symbol_short!("Balance")
            {
                changes.push(Map::<Symbol, Val>::from_val(&self.env, &body.data));
            }
        }
        assert_eq!(
            changes.len(),
            1,
            "one committed escrow change per invocation"
        );
        let last = &changes[0];
        let field = |name| last.get(Symbol::new(&self.env, name)).unwrap();
        assert_eq!(
            u64::try_from_val(&self.env, &field("bounty_id")).unwrap(),
            id
        );
        assert_eq!(
            Address::try_from_val(&self.env, &field("token")).unwrap(),
            self.tokens[token]
        );
        for (name, value) in [
            ("delta", delta),
            ("amount", delta.abs()),
            ("previous", previous),
            ("remaining", remaining),
        ] {
            assert_eq!(i128::try_from_val(&self.env, &field(name)).unwrap(), value);
        }
    }
}

#[test]
fn precision_metadata_does_not_rescale_funding_or_fee_payouts() {
    for target in 0..2 {
        let f = Fixture::new();
        let ids = [f.fund(0, AMOUNTS[0], 333), f.fund(1, AMOUNTS[1], 333)];
        let other = 1 - target;
        let other_before = f.balances(other);
        // A second bounty in the same asset proves per-bounty isolation as well.
        let sibling = f.fund(target, 101, 0);
        f.assert_change(sibling, target, 101, 0, 101);
        let amount = AMOUNTS[target];
        let stored = f.client().get_bounty(&ids[target]);
        assert_eq!(stored.token, f.tokens[target]);
        assert_eq!(stored.amount, amount);
        assert_eq!(
            f.balances(target),
            [MINTED - amount - 101, amount + 101, 0, 0]
        );
        f.client().reserve_bounty(&ids[target], &f.contributor);
        f.client().submit_bounty(&ids[target], &f.contributor);
        assert_eq!(
            f.balances(target),
            [MINTED - amount - 101, amount + 101, 0, 0]
        );
        f.client().release_bounty(&ids[target], &f.maintainer);
        // SDK 27 exposes only the last invocation; inspect before balance getters.
        f.assert_change(ids[target], target, -amount, amount, 0);
        // Both amounts leave a remainder: integer division floors the fee.
        let fee = amount * 333 / 10_000;
        assert_ne!(amount * 333 % 10_000, 0);
        assert_eq!(
            f.balances(target),
            [MINTED - amount - 101, 101, amount - fee, fee]
        );
        assert_eq!(f.balances(other), other_before);
        assert_eq!(f.client().get_bounty(&sibling).status, BountyStatus::Open);
        assert_eq!(
            f.client().get_bounty(&ids[target]).status,
            BountyStatus::Released
        );
    }
}

#[test]
fn expiry_refunds_exact_units_of_only_the_funded_asset() {
    for target in 0..2 {
        let f = Fixture::new();
        let ids = [f.fund(0, AMOUNTS[0], 333), f.fund(1, AMOUNTS[1], 333)];
        let other_before = f.balances(1 - target);
        f.env.ledger().set_timestamp(2_001);
        f.client().refund_bounty(&ids[target], &f.maintainer);
        f.assert_change(ids[target], target, -AMOUNTS[target], AMOUNTS[target], 0);
        assert_eq!(f.balances(target), [MINTED, 0, 0, 0]);
        assert_eq!(f.balances(1 - target), other_before);
        assert_eq!(
            f.client().get_bounty(&ids[target]).status,
            BountyStatus::Refunded
        );
        assert!(f
            .client()
            .try_refund_bounty(&ids[target], &f.maintainer)
            .is_err());
        assert_eq!(f.balances(target), [MINTED, 0, 0, 0]);
        assert_eq!(f.balances(1 - target), other_before);
    }
}

#[test]
fn another_assets_balance_cannot_cover_insufficient_funding() {
    let f = Fixture::new();
    let existing = f.fund(0, AMOUNTS[0], 0);
    let before = [f.balances(0), f.balances(1)];
    assert!(f
        .client()
        .try_create_bounty(
            &f.maintainer,
            &f.tokens[1],
            &(MINTED + 1),
            &String::from_str(&f.env, "org/repo"),
            &1910,
            &String::from_str(&f.env, "insufficient asset"),
            &2_000,
            &0,
            &None,
        )
        .is_err());
    assert_eq!([f.balances(0), f.balances(1)], before);
    assert_eq!(f.client().get_bounty(&existing).amount, AMOUNTS[0]);
    // Rejection must not consume an ID or create an escrow obligation.
    assert_eq!(f.fund(1, 101, 0), existing + 1);
}
