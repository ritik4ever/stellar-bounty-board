# FAQ

Frequently Asked Questions for the Stellar Bounty Board project.


# 1. How do I get testnet XLM?

You can fund your Stellar testnet account using Friendbot.

## Option 1 — Browser

Open:

```bash
https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY
```

Replace `YOUR_PUBLIC_KEY` with your Stellar testnet wallet address.

## Option 2 — cURL

```bash
curl "https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY"
```

## Verify Funding

Use Stellar Laboratory or Freighter to confirm your balance.

Useful resources:

* https://laboratory.stellar.org/
* https://developers.stellar.org/docs/tools/laboratory
* https://freighter.app/


# 2. How do I set up Freighter wallet?

1. Install Freighter extension:

   * https://freighter.app/

2. Create or import a wallet.

3. Switch network to **Testnet**.

4. Fund the wallet using Friendbot.

5. Connect wallet to the app.

## Common Issue

If the wallet does not connect:

* Refresh the page
* Unlock Freighter
* Ensure you are on Testnet
* Reconnect wallet permissions


# 3. Why is my signature rejected?

This usually happens because:

* Wrong network selected
* Expired transaction
* Invalid secret/public key pair
* Incorrect signing payload
* Wallet disconnected

## Fixes

### Verify Network

Ensure both:

* Wallet = Testnet
* App = Testnet

### Reconnect Wallet

Disconnect and reconnect Freighter.

### Regenerate Signature

Create a fresh transaction payload and sign again.

### Check Expiration

If the transaction expired, regenerate it before signing.


# 4. How do I reset the bounty store?

The project may use local storage, indexed storage, or backend persistence for bounty state.

## Frontend Reset

Clear browser storage:

```bash
localStorage.clear()
```

or clear site data from browser settings.

## Development Database Reset

If using Docker:

```bash
docker compose down -v
docker compose up
```

If using SQLite/Postgres, rerun migrations or reseed scripts.


# 5. How do I configure the expiration job?

Some bounties automatically expire after a configured duration.

## Typical Environment Variables

```env
EXPIRATION_JOB_INTERVAL=60
BOUNTY_EXPIRATION_HOURS=24
```

## Running Cron/Worker

Example:

```bash
npm run worker
```

or

```bash
npm run cron
```

depending on project scripts.

## Verify Expiration Logic

Check:

* Backend logs
* Scheduled job startup
* Database timestamps


# 6. Why are transactions failing?

Common causes include:

* Insufficient XLM balance
* Incorrect network
* Invalid contract ID
* Expired transaction
* RPC failure
* Bad signature

## Troubleshooting Steps

### Check Wallet Balance

Ensure your account has enough testnet XLM.

### Verify Contract Address

Double-check deployed contract IDs.

### Retry Transaction

Temporary RPC/network issues can occur.

### Inspect Logs

Backend logs usually provide exact failure details.


# 7. How does the dispute flow work?

The dispute system is designed to resolve bounty disagreements fairly.

## Typical Flow

1. Contributor submits work
2. Sponsor reviews submission
3. Sponsor approves or disputes
4. Admin/moderator may intervene
5. Funds are released or refunded

## Best Practices

* Include detailed submissions
* Attach screenshots or hashes
* Maintain communication records


# 8. How do I run the project locally?

## Install Dependencies

```bash
npm install
```

## Configure Environment

Create:

```bash
.env
```

and add required variables.

## Start Development Server

```bash
npm run dev
```

## Backend (if applicable)

```bash
npm run backend
```

or:

```bash
docker compose up
```


# 9. How do I run tests?

## Run All Tests

```bash
npm test
```

## Run Specific Tests

```bash
npm run test:unit
```

```bash
npm run test:integration
```

## Smart Contract Tests

```bash
cargo test
```

if Soroban contracts are included.


# 10. Why is my wallet not connecting?

## Possible Causes

* Freighter locked
* Browser permissions denied
* Wrong network
* Unsupported browser
* Extension conflict

## Solutions

### Unlock Freighter

Open extension and unlock it.

### Reconnect Permissions

Remove site permissions and reconnect.

### Refresh Browser

Reload app after wallet unlock.

### Supported Browsers

Recommended:

* Chrome
* Brave
* Edge


# 11. How do I deploy contracts to Stellar testnet?

## Build Contract

```bash
cargo build --target wasm32-unknown-unknown --release
```

## Deploy

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/contract.wasm \
  --source alice \
  --network testnet
```

## Verify Deployment

Use Stellar Laboratory or explorer tools.


# 12. Where can I find logs for debugging?

## Frontend Logs

Open browser DevTools:

```bash
F12 → Console
```

## Backend Logs

Run server in development mode:

```bash
npm run dev
```

or inspect Docker logs:

```bash
docker compose logs -f
```

## Contract Logs

Use Soroban CLI simulation tools and RPC responses.


# Additional Resources

* Stellar Docs: https://developers.stellar.org/
* Soroban Docs: https://developers.stellar.org/docs/smart-contracts
* Freighter Wallet: https://freighter.app/
* Stellar Laboratory: https://laboratory.stellar.org/


# Contributing

Please also review:

* `README.md`
* `CONTRIBUTING.md`

before submitting issues or pull requests.


# 13. Common Soroban RPC error messages

When interacting with Soroban RPC endpoints, developers may encounter various error messages. Below are common errors and their typical resolutions:

- **`rpc_error: server_error`** – Indicates the RPC node encountered an internal error. Retry the request after a short delay. If the issue persists, consider switching to a different RPC endpoint.
- **`rpc_error: timeout`** – The request timed out. This can happen under high network latency or node overload. Implement exponential backoff and increase the timeout setting if appropriate.
- **`rpc_error: rate_limited`** – The node is rate‑limiting requests. Follow the rate‑limiting guidance below.
- **`rpc_error: transaction_failed`** – The transaction was rejected (e.g., insufficient balance, bad signature). Review the transaction details and ensure the account is funded.

# 14. Funding a testnet account via Friendbot

If a transaction fails due to an insufficient XLM balance, you can quickly fund a testnet account using Friendbot:

## Browser method
1. Open your browser and navigate to:
   ```
   https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY
   ```
2. Replace `YOUR_PUBLIC_KEY` with the public key of the account you wish to fund.
3. The page will display a JSON response confirming the transaction hash.

## cURL method
```bash
curl "https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY"
```
Replace `YOUR_PUBLIC_KEY` accordingly. Verify the response contains a `hash` field indicating success.

After funding, you can verify the balance using Stellar Laboratory or the `GET /accounts/{account_id}` RPC endpoint.

# 15. RPC rate‑limiting and timeout guidance

Soroban RPC nodes enforce rate limits to protect against abuse. If you see `rpc_error: rate_limited`:

- **Back‑off strategy**: Wait at least 1 second before retrying, then double the wait time on each subsequent failure (exponential back‑off) up to a maximum of 30 seconds.
- **Batch requests**: Where possible, combine multiple queries into a single request using the `batch` RPC method.
- **Alternative endpoints**: Switch to another public RPC node or run a local Soroban RPC instance.

For timeout errors (`rpc_error: timeout`), consider increasing the client timeout setting (e.g., from 5 s to 15 s) and ensure your network connection is stable.

# 16. Monitoring network health

Stellar and Soroban status pages provide real‑time information about network health, node availability, and known incidents:

- **Stellar Horizon status**: https://status.stellar.org/
- **Soroban RPC status**: https://status.soroban.org/
- **StellarOps incident tracker**: https://stellarops.org/incidents

Check these pages when you encounter persistent RPC errors to see if there are ongoing outages or maintenance.

# Additional Resources

* https://developers.stellar.org/docs/tools/friendbot
* https://developers.stellar.org/docs/api/rpc
* https://developers.stellar.org/docs/issuing-assets
* https://developers.stellar.org/docs/soroban/overview

# Contributing

Please also review:

* `README.md`
* `CONTRIBUTING.md`

before submitting issues or pull requests.
