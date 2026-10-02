# Local Development

A practical guide to running stellar-bounty-board on your own machine.

## Prerequisites

| Tool     | Version  | Required for        |
| -------- | -------- | ------------------- |
| Node.js  | 20+      | Backend + Frontend  |
| npm      | 10+      | Package management  |
| git      | 2.30+    | Cloning + branching |
| Stellar CLI | latest | Contract builds (optional — only if you intend to touch `contracts/`) |

## First-Time Setup

```bash
git clone https://github.com/ritik4ever/stellar-bounty-board.git
cd stellar-bounty-board

# Backend
cd backend
npm install
npm run gen:openapi   # regenerates docs/openapi.generated.json

# Frontend
cd ../frontend
npm install
```

## Running Locally

Open two terminals:

```bash
# Terminal 1 — backend (port 3001)
cd backend
npm run dev          # tsx watch src/index.ts

# Terminal 2 — frontend (port 3000)
cd frontend
npm run dev          # vite
```

Open http://localhost:3000 — the React dashboard should load and call http://localhost:3001/api/bounties.

## Port Layout

| Service   | Port | Notes |
| --------- | ---- | ----- |
| Frontend  | 3000 | Vite dev server |
| Backend   | 3001 | Express API |

## Environment Variables

Most behaviour works without any env vars. Optional overrides:

| Name                     | Default | Purpose |
| ------------------------ | ------- | ------- |
| `PORT`                   | 3001    | Backend listen port |
| `BOUNTIES_FILE`          | `backend/data/bounties.json` | Path to JSON persistence |
| `ADMIN_KEY_HASH`         | (none)  | SHA-256 hash of admin password (see `scripts/hash-admin-key.js`) |

## Common Issues

**Port already in use:** `lsof -i :3001` to find and `kill -9 <pid>` the offending process.

**OpenAPI drift after editing routes:** `cd backend && npm run gen:openapi` to regenerate `docs/openapi.generated.json`.

**JSON file lock errors under WSL:** ensure the repo is on the Linux filesystem (`~/`) not the Windows mount (`/mnt/c/...`).

## Debugging Tips

- The backend logs every request to stdout in dev mode — `tail -f` the terminal to see incoming calls.
- The frontend uses Vite's overlay to surface errors — keep it visible while debugging.
- Use `npm run test:watch` (backend) to keep tests re-running on save during TDD.

## See Also

- `docs/TESTING.md` — test stack and conventions
- `docs/deployment.md` — production deployment guide
- `docs/ARCHITECTURE.md` — high-level design overview
