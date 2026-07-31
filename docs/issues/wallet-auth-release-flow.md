# Add Freighter Wallet Signing For Maintainer Actions

Labels: `enhancement`, `wallet`, `help wanted`

## Summary

Replace prompt-based maintainer confirmation in the frontend with Freighter wallet signing for release and refund flows.

## Why It Matters

- Makes the demo feel closer to a real Stellar production flow
- Creates clearer authorization boundaries for payout actions
- Unblocks later Soroban transaction integration

## Acceptance Criteria

- Maintainer connects Freighter before release or refund
- Frontend signs the action with the connected address
- Backend verifies the signed payload before changing bounty state
- Error states are shown clearly in the UI

