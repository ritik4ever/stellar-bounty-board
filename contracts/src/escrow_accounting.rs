//! Canonical per-bounty escrow accounting event.
//!
//! This is NOT the token contract's aggregate balance. Each bounty holds a
//! separately accounted obligation denominated in the funded token's smallest
//! units; multiple bounties can share one token contract and vault address.

use soroban_sdk::{contracttype, symbol_short, Address, Env};

use crate::{Bounty, BountyStatus};

/// One signed per-bounty escrow balance movement, emitted only for a successful
/// token movement in the same committed invocation as the bounty state change.
///
/// # Schema for off-chain consumers
///
/// Topic tuple: `(symbol_short!("Escrow"), symbol_short!("Balance"))`.
///
/// Data fields, in this deterministic order:
/// 1. `bounty_id` — the on-chain bounty whose liability changed.
/// 2. `token` — contract address of the token actually funded for this bounty.
/// 3. `delta` — signed movement in native token units: positive when funded,
///    negative when fully settled.
/// 4. `amount` — magnitude of the movement (`delta.abs()`), always non-negative.
/// 5. `previous_remaining` — escrow amount owed to this bounty before the
///    transition.
/// 6. `remaining` — escrow amount still owed to this bounty after the
///    transition.
/// 7. `status` — bounty status corresponding to the committed balance change.
///
/// Consumers can reconstruct the committed change exactly once: for a given
/// `bounty_id` and `token`, `previous_remaining + delta == remaining` and
/// `amount == delta.abs()`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowBalanceChanged {
    /// The on-chain bounty whose liability changed.
    pub bounty_id: u64,
    /// Contract address of the token actually funded for this bounty.
    pub token: Address,
    /// Positive when funded, negative when fully settled; native token units.
    pub delta: i128,
    /// Magnitude of the movement (`delta.abs()`); always non-negative.
    pub amount: i128,
    /// Escrow amount still owed to this bounty before the transition.
    pub previous_remaining: i128,
    /// Escrow amount still owed to this bounty after the transition.
    pub remaining: i128,
    /// Bounty status corresponding to the committed balance change.
    pub status: BountyStatus,
}

/// Publish *before* the corresponding existing lifecycle event, but only after
/// token movement and bounty storage updates have succeeded. A failing Soroban
/// invocation rolls back the token movements, storage writes and emitted events.
///
/// This is the single emission point for [`EscrowBalanceChanged`]; callers must
/// invoke it only once per committed transition, after the bounty state has been
/// written, so consumers observe exactly one event per committed change.
pub(crate) fn publish_escrow_change(env: &Env, bounty_id: u64, bounty: &Bounty, delta: i128) {
    let remaining = match bounty.status {
        BountyStatus::Released | BountyStatus::Refunded => 0,
        _ => bounty.amount,
    };
    let previous_remaining = remaining - delta;
    let amount = delta.abs();

    env.events().publish(
        (symbol_short!("Escrow"), symbol_short!("Balance")),
        EscrowBalanceChanged {
            bounty_id,
            token: bounty.token.clone(),
            delta,
            amount,
            previous_remaining,
            remaining,
            status: bounty.status,
        },
    );
}
