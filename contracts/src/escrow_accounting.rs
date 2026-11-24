//! Canonical per-bounty escrow accounting event.
//!
//! This is NOT the token contract's aggregate balance. Each bounty holds a
//! separately accounted obligation denominated in the funded token's smallest
//! units; multiple bounties can share one token contract and vault address.

use soroban_sdk::{contracttype, symbol_short, Address, Env};

use crate::{Bounty, BountyStatus};

/// One signed per-bounty escrow balance movement, emitted only for a successful
/// token movement in the same committed invocation as the bounty state change.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowBalanceChanged {
    /// The on-chain bounty whose liability changed.
    pub bounty_id: u64,
    /// Contract address of the token actually funded for this bounty.
    pub token: Address,
    /// Positive when funded, negative when fully settled; native token units.
    pub delta: i128,
    /// Escrow amount still owed to this bounty after the transition.
    pub remaining: i128,
    /// Bounty status corresponding to the committed balance change.
    pub status: BountyStatus,
}

/// Publish *before* the corresponding existing lifecycle event, but only after
/// token movement and bounty storage updates have succeeded. A failing Soroban
/// invocation rolls back the token movements, storage writes and emitted events.
pub(crate) fn publish_escrow_change(env: &Env, bounty_id: u64, bounty: &Bounty, delta: i128) {
    let remaining = match bounty.status {
        BountyStatus::Released | BountyStatus::Refunded => 0,
        _ => bounty.amount,
    };

    env.events().publish(
        (symbol_short!("Escrow"), symbol_short!("Balance")),
        EscrowBalanceChanged {
            bounty_id,
            token: bounty.token.clone(),
            delta,
            remaining,
            status: bounty.status,
        },
    );
}
