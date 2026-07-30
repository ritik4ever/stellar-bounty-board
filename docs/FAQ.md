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

When interacting with Soroban RPC endpoints locally or on testnet, contributors and developers may encounter various RPC and contract execution errors. Below are common error codes, messages, and their step-by-step resolutions:

## RPC Protocol & Server Errors

- **`rpc_error: server_error` / JSON-RPC `-32603` (Internal Error)**
  - *Cause*: The Soroban RPC node encountered an internal error during processing, unhandled exception, or transient node unsync.
  - *Resolution*: 
    1. Wait 1–2 seconds and retry the operation.
    2. Check if the local Stellar/Soroban container is healthy (`docker ps` or `stellar network container status`).
    3. If using a public RPC node, switch to an alternative endpoint (e.g., `https://soroban-testnet.stellar.org`).

- **`rpc_error: rate_limited` / HTTP 429 (Too Many Requests)**
  - *Cause*: Exceeded maximum allowed requests per second/minute on the RPC provider.
  - *Resolution*: See **Section 15** below for exponential backoff retry strategies and batching queries.

- **`rpc_error: timeout` / HTTP 504 (Gateway Timeout)**
  - *Cause*: RPC request timed out while waiting for transaction simulation, ledger state lookup, or transaction ingestion.
  - *Resolution*: Increase your RPC client timeout setting (e.g., from 5s to 15s–30s) and retry with backoff.

- **JSON-RPC `-32600` (Invalid Request)**
  - *Cause*: Malformed JSON payload, missing required RPC params, or invalid parameter types (e.g., sending raw string instead of XDR).
  - *Resolution*: Verify payload structure against the official Soroban RPC JSON-RPC API specification. Ensure XDR strings are base64 encoded.

## Transaction Simulation & Host Errors

- **`HostError: Error(Storage, MissingValue)`**
  - *Cause*: The contract or account storage key requested does not exist on-chain or its TTL (Time-To-Live) has expired.
  - *Resolution*: Re-initialize or re-fund the storage entry, extend the instance/entry TTL using `extend_ttl`, or verify key parameters.

- **`HostError: Error(Budget, ExceededLimit)` / `Exceeded CPU instruction budget` / `Exceeded memory limit`**
  - *Cause*: The smart contract execution exceeded maximum CPU instructions or memory allocation limits.
  - *Resolution*: Optimize contract loops, reduce state access, or split heavy operations into multiple transactions. When simulating, ensure resource limits in the simulation footprint are correctly set.

- **`HostError: Error(Contract, #)` (e.g. `Error(Contract, 1)`)**
  - *Cause*: The smart contract panicked or explicitly returned an error code defined in its custom error enum.
  - *Resolution*: Check the contract source code for `#[contracterror]` or `panic!` calls corresponding to error code `#`. Verify preconditions (e.g., caller authorization, parameter bounds).

## Transaction Submission Result Errors

- **`txINSUFFICIENT_BALANCE` / `txFAILED` due to balance**
  - *Cause*: The source account does not have enough XLM to pay transaction fees or maintain the minimum ledger reserve balance (0.5 XLM per entry/subentry).
  - *Resolution*: Fund the testnet account via Friendbot (see **Section 14**).

- **`txBAD_SEQ` (Bad Sequence Number)**
  - *Cause*: The account sequence number used in the transaction is behind or ahead of the current ledger sequence number for the account.
  - *Resolution*: Re-fetch the current account sequence number from the RPC endpoint using `getAccount` before signing and submitting.

- **`txEXPIRED` (Transaction Expired)**
  - *Cause*: The transaction's time-bounds (`timeBounds` / `ledgerBounds`) passed before the transaction was included in a ledger.
  - *Resolution*: Re-simulate, update the transaction deadline/timebounds, re-sign, and resubmit.

- **`txBAD_AUTH` / `txBAD_AUTH_EXTRA`**
  - *Cause*: Invalid, missing, or mismatched cryptographic signatures for account or contract authorization entries (`sorobanAuthorizedInvocation`).
  - *Resolution*: Ensure the proper keypair signed the transaction and that authorization credentials match the expected invoker address.

- **`txINSUFFICIENT_FEE`**
  - *Cause*: The base fee specified is lower than the minimum network inclusion fee or current surge pricing requirement.
  - *Resolution*: Increase the max transaction fee (e.g., set fee to at least 100,000 stroops or query `getFeeStats`).


# 14. Funding a testnet account via Friendbot

When transactions fail with `txINSUFFICIENT_BALANCE` or when setting up a fresh testnet development wallet, use Stellar Friendbot to automatically fund your account with 10,000 testnet XLM.

## Step 1 — Obtain Your Public Address

Your public address starts with `G...` (for account keys) or `C...` (for contract addresses). Ensure you have your public key copied.

## Step 2 — Call Friendbot

### Option A: Browser Method
1. Navigate in your browser to:
   ```
   https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY
   ```
2. Replace `YOUR_PUBLIC_KEY` with your Stellar testnet account address (e.g., `G...`).
3. You will receive a JSON response confirming successful funding:
   ```json
   {
     "successful": true,
     "hash": "f3808dafd88098ea3a096bcfef1d75e6915140916ed0eb271d5ce9362ffa4caa",
     "envelope_xdr": "..."
   }
   ```

### Option B: cURL / Terminal Method
Run the following cURL command in your terminal:
```bash
curl -s "https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY"
```
Replace `YOUR_PUBLIC_KEY` with your public address.

### Option C: Stellar / Soroban CLI
If using `stellar-cli` / `soroban-cli`:
```bash
stellar keys fund my-account-name --network testnet
```

## Step 3 — Verify Your Funded Balance

Confirm the account has been funded using any of the following methods:

1. **Stellar Laboratory**: Visit [Stellar Laboratory Account Explorer](https://laboratory.stellar.org/#account-viewer?network=test) and enter your public key.
2. **Soroban RPC `getAccount` Request**:
   ```bash
   curl -X POST "https://soroban-testnet.stellar.org/" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "getLedgerEntries",
       "params": {
         "keys": ["YOUR_ACCOUNT_XDR_KEY"]
       }
     }'
   ```
3. **Horizon API**:
   ```bash
   curl -s "https://horizon-testnet.stellar.org/accounts/YOUR_PUBLIC_KEY"
   ```
   Check the `balances` array in the JSON response to verify the XLM amount.


# 15. RPC rate-limiting and timeout guidance

Public Soroban RPC nodes enforce rate limits to protect infrastructure from traffic spikes. If your application or test suite encounters `rpc_error: rate_limited` (HTTP 429) or timeouts (`rpc_error: timeout` / HTTP 504), apply the following retry and mitigation patterns:

## 1. Exponential Backoff with Jitter Strategy

Implement exponential backoff when retrying RPC queries or transaction submissions:

- **Initial Delay**: Wait 1 second (1000ms) after the first rate-limit/timeout failure.
- **Backoff Multiplier**: Double the delay on each subsequent retry (1s -> 2s -> 4s -> 8s -> 16s -> 30s).
- **Max Delay Cap**: Cap the delay at 30 seconds.
- **Random Jitter**: Add a small random jitter (±200ms) to prevent synchronization thundering herd problems across multiple concurrent clients.

### Example Retry Logic (TypeScript / JavaScript)
```typescript
async function fetchWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  initialDelayMs = 1000
): Promise<T> {
  let delay = initialDelayMs;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimited = err?.status === 429 || err?.message?.includes('rate_limited');
      const isTimeout = err?.status === 504 || err?.message?.includes('timeout');
      if ((isRateLimited || isTimeout) && attempt < maxRetries - 1) {
        const jitter = Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        delay = Math.min(delay * 2, 30000);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}
```

## 2. Request Optimization & Batching

- **Batch Queries**: Combine multiple `getLedgerEntries` or `getTransaction` calls into single JSON-RPC batch requests where supported.
- **Cache Simulation Footprints**: Avoid redundant contract simulation calls (`simulateTransaction`) when parameters have not changed.

## 3. Alternative Endpoints & Local RPC Nodes

- **Switch RPC Providers**: If the default public node is overloaded, use alternative public endpoints or dedicated RPC node providers.
- **Run Local Soroban RPC Node**: For local development and CI testing, run a local Standalone network container which has no rate limits:
  ```bash
  docker run --rm -it \
    -p 8000:8000 \
    --name stellar \
    stellar/quickstart:testing \
    --local \
    --enable-soroban-rpc
  ```


# 16. Monitoring network health

Before debugging persistent RPC failures or transaction timeouts, verify whether the Stellar or Soroban network is experiencing an outage or degraded performance:

- **Official Stellar Status Page**: [status.stellar.org](https://status.stellar.org/) — Real-time updates on Horizon, Core nodes, Friendbot, and Soroban RPC status across Mainnet and Testnet.
- **Stellar Dashboard**: [dashboard.stellar.org](https://dashboard.stellar.org/) — Live network metrics, ledger close times, transaction throughput, and validator node health.
- **Soroban Testnet RPC Health Endpoint**:
  ```bash
  curl -s "https://soroban-testnet.stellar.org/health"
  ```
  Expected healthy response:
  ```json
  { "status": "healthy" }
  ```
- **Stellar Developer Discord & Community Support**: [Stellar Developer Discord](https://discord.gg/stellardev) — Check the `#soroban` and `#dev-announcements` channels for real-time network maintenance notifications.


# Additional Resources
* Stellar Developer Documentation: https://developers.stellar.org/
* Soroban Smart Contracts Guide: https://developers.stellar.org/docs/smart-contracts
* Friendbot Tooling Guide: https://developers.stellar.org/docs/tools/friendbot
* Soroban RPC API Reference: https://developers.stellar.org/docs/data/rpc
* Stellar Laboratory: https://laboratory.stellar.org/


# Contributing

Please also review:

* `README.md`
* `CONTRIBUTING.md`

before submitting issues or pull requests.

