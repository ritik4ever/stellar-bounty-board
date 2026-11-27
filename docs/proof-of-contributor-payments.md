# Proof of Contributor Payments & Escrow Transparency

This document details how contributor rewards are managed, verified on-chain, and paid out through Stellar Bounty Board.

## Overview

Stellar Bounty Board utilizes Soroban smart contracts on the Stellar network to escrow and distribute contributor payouts. All transactions are public, verifiable, and non-custodial.

---

## 1. How Payments Work: The Escrow Lifecycle

```
[Maintainer Funds Bounty]
         │
         ▼
[Funds Locked in Soroban Contract Escrow]
         │
         ▼
[Contributor Claims & Submits PR]
         │
         ▼
[Maintainer Approves via Freighter Wallet]
         │
         ▼
[Contract Releases Escrowed Funds to Contributor Address]
         │
         ▼
[On-Chain Event Emitted: BountyReleased]
```

1. **Funding:** When a bounty is published, reward tokens (e.g., XLM, USDC) are transferred into the smart contract escrow. The `BountyFunded` event is emitted.
2. **Reservation & Submission:** Contributors reserve an issue and submit their pull request link.
3. **Release & Payout:** The maintainer approves the work and signs an authorized release payload. The smart contract immediately transfers the exact reward to the contributor's Stellar account.
4. **Finality:** The contract emits `BountyReleased(bounty_id, contributor, token, amount)`, creating an immutable record on the ledger.

---

## 2. On-Chain Verification

### Inspecting Transactions on Stellar Expert
Every transaction on the Stellar network can be audited on block explorers such as [Stellar Expert](https://stellar.expert/explorer/testnet/):
- Search the **Escrow Contract ID** configured in `docs/deployment.md` or the repository environment (`SOROBAN_CONTRACT_ID`).
- View contract invocations: `fund`, `reserve`, `submit`, and `release`.
- Verify the token transfers (`transfer`) executed from the contract address to contributor public keys (`G...`).

### Querying Events via Soroban RPC
Indexers and contributors can query contract events via `getEvents`:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getEvents",
  "params": {
    "startLedger": 1000,
    "filters": [
      {
        "type": "contract",
        "contractIds": ["<SOROBAN_CONTRACT_ID>"],
        "topics": [["*", "release"]]
      }
    ]
  }
}
```

---

## 3. GitHub Bounty Tracking

Contributors can inspect historical rewarded tasks and merges across waves:
- **Completed Bounties:** All rewarded community issues are labeled [`Stellar Wave`](https://github.com/ritik4ever/stellar-bounty-board/issues?q=label%3A%22Stellar+Wave%22+is%3Aclosed) and linked to their closing pull requests.
- **Automated Payout Pipeline:** Merged pull requests trigger the bounty release flow and update bounty records in the platform store.

---

## 4. FAQ Reference
For quick guidance on picking up an issue or verifying your wallet connection, see [FAQ.md](./FAQ.md).
