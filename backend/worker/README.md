# Soroban Contract Event Indexer Worker

This worker polls Soroban contract events and normalizes them for backend use. It is isolated from the main API server and can be run as a separate process.

## How It Works

- Polls the Soroban RPC endpoint for contract events (create, reserve, release, refund)
- Normalizes events into backend-friendly records
- Appends new events to a local file (`indexed-events.json`) for demonstration (replace with DB logic as needed)
- Handles errors gracefully so failures do not affect the main API server

## Polling & Backoff (issue #809)

The worker self-schedules polls with `setTimeout` so a failed poll can delay the
next attempt:

- Under normal conditions it polls every `SOROBAN_POLL_INTERVAL_MS` (default: `10000`ms).
- When the Soroban RPC endpoint returns errors or times out, the next poll is
  delayed by `POLL_INTERVAL_MS × 2^failures` (exponential backoff), capped at
  `SOROBAN_MAX_BACKOFF_MS` (default: 5 minutes).
- After the first successful poll, the backoff resets and the worker returns to
  the base interval.
- Every backoff entry/reset transition is logged with the failure count and the
  next poll delay for observability.
- Each individual poll still retries transient failures internally up to
  `SOROBAN_MAX_RETRIES` times (default: `5`); only when those retries are
  exhausted does the poll count as a failure and trigger the poll-level backoff.

## Usage

1. Set environment variables:
   - `SOROBAN_CONTRACT_ID` (required): The contract ID to index
   - `SOROBAN_RPC_URL` (optional): Soroban RPC endpoint (default: `https://rpc-futurenet.stellar.org`)
   - `SOROBAN_POLL_INTERVAL_MS` (optional): Base polling interval in ms (default: `10000`)
   - `SOROBAN_MAX_BACKOFF_MS` (optional): Max backoff delay in ms (default: `300000` = 5 minutes)
   - `SOROBAN_MAX_RETRIES` (optional): Internal retries per poll (default: `5`)

2. Run the worker:

```bash
cd backend/worker
node indexer.mjs
```

The worker is also spawned automatically as a worker thread by the backend
server (`npm --prefix backend run dev` / `npm start`).

## Architecture

- The worker is completely isolated from the main API server.
- It can be run as a background process or managed by a process manager (e.g., PM2, systemd).
- Events are normalized using a mapping function and stored for backend consumption.
- Extend the normalization logic as the contract evolves.

## Extending

- Replace file storage with a database for production use.
- Add more robust error handling and alerting as needed.
- Integrate with backend API or event consumers if required.

---

For questions, see the main [README.md](../README.md) or open an issue.
