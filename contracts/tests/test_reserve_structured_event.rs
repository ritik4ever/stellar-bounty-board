use soroban_sdk::{
    contract, contractimpl, symbol_short, vec,
    testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
    IntoVal,
    Address, Env, String, FromVal,
};
use stellar_bounty_board::{
    BountyReserved, BountyReservedEvent, BountyStatus, StellarBountyBoardContract,
    StellarBountyBoardContractClient,
};

#[contract]
struct PermissiveToken;

#[contractimpl]
impl PermissiveToken {
    pub fn transfer(env: Env, _from: Address, _to: Address, _amount: i128) {
        let key = symbol_short!("COUNT");
        let count = env.storage().instance().get::<_, u32>(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(count + 1));
    }
}

struct Fixture {
    env: Env,
    client: StellarBountyBoardContractClient<'static>,
    maintainer: Address,
    contributor: Address,
    token: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    let contract = env.register(StellarBountyBoardContract, ());
    let client = StellarBountyBoardContractClient::new(&env, &contract);
    let admin = Address::generate(&env);
    let maintainer = Address::generate(&env);
    let contributor = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    let arbiter = Address::generate(&env);
    client.initialize(&admin, &fee_recipient, &arbiter, &600);

    let token = env.register(PermissiveToken, ());

    Fixture {
        env,
        client,
        maintainer,
        contributor,
        token,
    }
}

#[test]
fn test_reserve_bounty_emits_structured_event() {
    let f = setup();
    let amount = 500i128;
    let repo = String::from_str(&f.env, "repo");
    let title = String::from_str(&f.env, "title");
    let deadline = f.env.ledger().timestamp() + 1_000;

    let bounty_id = f
        .client
        .mock_auths(&[MockAuth {
            address: &f.maintainer,
            invoke: &MockAuthInvoke {
                contract: &f.client.address,
                fn_name: "create_bounty",
                args: vec![
                    &f.env,
                    f.maintainer.clone().into_val(&f.env),
                    f.token.clone().into_val(&f.env),
                    amount.into_val(&f.env),
                    repo.clone().into_val(&f.env),
                    1u32.into_val(&f.env),
                    title.clone().into_val(&f.env),
                    deadline.into_val(&f.env),
                    0u32.into_val(&f.env),
                    None::<()>.into_val(&f.env),
                ],
                sub_invokes: &[],
            },
        }])
        .create_bounty(
            &f.maintainer,
            &f.token,
            &amount,
            &repo,
            &1u32,
            &title,
            &deadline,
            &0u32,
            &None,
        );

    let before_timestamp = f.env.ledger().timestamp();
    f.client
        .mock_auths(&[MockAuth {
            address: &f.contributor,
            invoke: &MockAuthInvoke {
                contract: &f.client.address,
                fn_name: "reserve_bounty",
                args: vec![
                    &f.env,
                    bounty_id.into_val(&f.env),
                    f.contributor.clone().into_val(&f.env),
                ],
                sub_invokes: &[],
            },
        }])
        .reserve_bounty(&bounty_id, &f.contributor);
    let after_timestamp = f.env.ledger().timestamp();

    let events = f.env.events().all().filter_by_contract(&f.client.address);
    let event_list = events.events();

    // The structured reserve event is the *last* event emitted by this call.
    let structured_event = event_list.last().unwrap();
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &structured_event.body;
    let t0 = soroban_sdk::Symbol::from_val(&f.env, &body.topics[0]);
    let t1 = soroban_sdk::Symbol::from_val(&f.env, &body.topics[1]);
    assert_eq!(t0, symbol_short!("Bounty"));
    assert_eq!(t1, symbol_short!("ReservEvt"));
    let structured_payload = BountyReservedEvent::from_val(&f.env, &body.data);
    assert_eq!(
        structured_payload,
        BountyReservedEvent {
            bounty_id,
            contributor: f.contributor.clone(),
            reserved_at: after_timestamp,
            bounty_status_after_reserve: BountyStatus::Reserved,
        }
    );
    assert!(
        structured_payload.reserved_at >= before_timestamp
            && structured_payload.reserved_at <= after_timestamp,
        "reserved_at should be within the observed ledger window"
    );

    // The legacy lightweight event is still emitted, just before the structured one.
    let legacy_event = event_list.get(event_list.len() - 2).unwrap();
    let soroban_sdk::xdr::ContractEventBody::V0(body) = &legacy_event.body;
    let t0 = soroban_sdk::Symbol::from_val(&f.env, &body.topics[0]);
    let t1 = soroban_sdk::Symbol::from_val(&f.env, &body.topics[1]);
    assert_eq!(t0, symbol_short!("Bounty"));
    assert_eq!(t1, symbol_short!("Reserv"));
    let legacy_payload = BountyReserved::from_val(&f.env, &body.data);
    assert_eq!(
        legacy_payload,
        BountyReserved {
            bounty_id,
            contributor: f.contributor.clone(),
        }
    );

    let bounty = f.client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);
    assert_eq!(bounty.contributor, Some(f.contributor));
}
