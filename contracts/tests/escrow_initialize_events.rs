//! Focused integration tests for escrow initialization events (SBB-2026-404).
//!
//! Verifies that:
//! - A committed `initialize` invocation emits exactly one `("Escrow", "Init")`
//!   event with an `EscrowInitialized` payload whose fields match committed
//!   contract state and immutable arbiter identity.
//! - Rejected re-initialization attempts roll back atomically and emit zero
//!   events, preserving the original committed state and arbiter identity.
//! - Consumers can reconstruct the committed initialization change once from
//!   the single emitted event without follow-up contract reads.
//! - No live funds are used; all tests run against Soroban's in-memory test
//!   environment.

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    xdr::ContractEventBody,
    Address, Env, FromVal, Symbol,
};
use stellar_bounty_board::{
    EscrowInitialized, StellarBountyBoardContract, StellarBountyBoardContractClient,
    DEFAULT_MIN_ARBITER_STAKE, DEFAULT_MIN_BOUNTY_AMOUNT,
};

const DISPUTE_WINDOW: u64 = 600;
const INIT_TIMESTAMP: u64 = 1_700_000_000;

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    admin: Address,
    fee_recipient: Address,
    arbiter: Address,
}

fn setup_uninitialized() -> Fixture {
    let env = Env::default();
    env.ledger().with_mut(|li| {
        li.timestamp = INIT_TIMESTAMP;
    });

    let contract_id = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let arbiter = Address::generate(&env);

    Fixture {
        env,
        client,
        admin,
        fee_recipient,
        arbiter,
    }
}

fn decode_init_events(env: &Env) -> Vec<(Symbol, Symbol, EscrowInitialized)> {
    let mut out = Vec::new();
    for event in env.events().all().events().iter() {
        let ContractEventBody::V0(v0) = &event.body;
        if v0.topics.len() == 2 {
            let t0 = Symbol::from_val(env, &v0.topics[0]);
            let t1 = Symbol::from_val(env, &v0.topics[1]);
            if t0 == Symbol::new(env, "Escrow") && t1 == Symbol::new(env, "Init") {
                let payload = EscrowInitialized::from_val(env, &v0.data);
                out.push((t0, t1, payload));
            }
        }
    }
    out
}

#[test]
fn initialize_emits_single_aligned_event_with_immutable_arbiter() {
    let f = setup_uninitialized();

    f.client
        .initialize(&f.admin, &f.fee_recipient, &f.arbiter, &DISPUTE_WINDOW);

    // Exactly one contract event is emitted on committed initialization.
    assert_eq!(f.env.events().all().events().len(), 1);

    let init_events = decode_init_events(&f.env);
    assert_eq!(init_events.len(), 1);

    let (t0, t1, payload) = &init_events[0];
    assert_eq!(*t0, Symbol::new(&f.env, "Escrow"));
    assert_eq!(*t1, Symbol::new(&f.env, "Init"));

    // Payload fields match committed contract state and inputs exactly.
    assert_eq!(
        *payload,
        EscrowInitialized {
            admin: f.admin.clone(),
            fee_recipient: f.fee_recipient.clone(),
            arbiter: f.arbiter.clone(),
            dispute_window: DISPUTE_WINDOW,
            min_bounty_amount: DEFAULT_MIN_BOUNTY_AMOUNT,
            min_arbiter_stake: DEFAULT_MIN_ARBITER_STAKE,
            initialized_at: INIT_TIMESTAMP,
        }
    );

    // Cross-check against on-chain getters to confirm event-state alignment.
    assert_eq!(payload.arbiter, f.client.get_arbiter());
    assert_eq!(payload.fee_recipient, f.client.get_fee_recipient());
    assert_eq!(payload.min_bounty_amount, f.client.get_min_bounty_amount());
    assert_eq!(f.client.get_next_bounty_id(), 0);
    assert!(!f.client.get_paused_state());
}

#[test]
fn rejected_reinitialize_emits_zero_events_and_preserves_state() {
    let f = setup_uninitialized();

    f.client
        .initialize(&f.admin, &f.fee_recipient, &f.arbiter, &DISPUTE_WINDOW);
    assert_eq!(decode_init_events(&f.env).len(), 1);

    // Advance ledger timestamp to verify a second call cannot overwrite state or emit events.
    f.env.ledger().with_mut(|li| {
        li.timestamp = INIT_TIMESTAMP + 500;
    });

    let attacker_admin = Address::generate(&f.env);
    let attacker_fee = Address::generate(&f.env);
    let attacker_arbiter = Address::generate(&f.env);

    let err = f.client.try_initialize(
        &attacker_admin,
        &attacker_fee,
        &attacker_arbiter,
        &1_200,
    );
    assert!(err.is_err(), "re-initialization must fail");

    // Failed invocation rolls back atomically and emits zero events.
    assert_eq!(f.env.events().all().events().len(), 0);
    assert_eq!(decode_init_events(&f.env).len(), 0);

    // Original immutable arbiter and initialized contract state remain intact.
    assert_eq!(f.client.get_arbiter(), f.arbiter);
    assert_eq!(f.client.get_fee_recipient(), f.fee_recipient);
    assert_eq!(f.client.get_min_bounty_amount(), DEFAULT_MIN_BOUNTY_AMOUNT);
}

#[test]
fn consumer_can_reconstruct_committed_initialization_once() {
    let f = setup_uninitialized();

    f.client
        .initialize(&f.admin, &f.fee_recipient, &f.arbiter, &DISPUTE_WINDOW);

    // Consumer reconstructs committed contract configuration solely from the event stream.
    let mut reconstructed: Option<EscrowInitialized> = None;
    for (_, _, payload) in decode_init_events(&f.env) {
        assert!(
            reconstructed.is_none(),
            "initialization event must be emitted at most once"
        );
        reconstructed = Some(payload);
    }

    let state = reconstructed.expect("expected one EscrowInitialized event");
    assert_eq!(state.admin, f.admin);
    assert_eq!(state.fee_recipient, f.fee_recipient);
    assert_eq!(state.arbiter, f.arbiter);
    assert_eq!(state.dispute_window, DISPUTE_WINDOW);
    assert_eq!(state.min_bounty_amount, DEFAULT_MIN_BOUNTY_AMOUNT);
    assert_eq!(state.min_arbiter_stake, DEFAULT_MIN_ARBITER_STAKE);
    assert_eq!(state.initialized_at, INIT_TIMESTAMP);
}
