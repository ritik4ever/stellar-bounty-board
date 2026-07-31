# Soroban Contract Event Indexer Worker

This worker polls Soroban contract events and normalizes them for backend use. It is isolated from the main API server and can be run as a separate process.

## How It Works
- Polls the Soroban RPC endpoint for contract events (create, reserve, release, refund)
- Normalizes events into backend-friendly records
- Appends new events to a local file (`indexed-events.json`) for demonstration (replace with DB logic as needed)
- Handles errors gracefully so failures do not affect the main API server

## Usage

1. Set environment variables:
   - `SOROBAN_CONTRACT_ID` (required): The contract ID to index
   - `SOROBAN_RPC_URL` (optional): Soroban RPC endpoint (default: `https://rpc-futurenet.stellar.org`)

2. Run the worker:

```bash
cd backend/worker
node indexer.js
```

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
