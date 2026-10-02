# Monorepo Layout

A top-level map of where things live in stellar-bounty-board.

## Top-Level Directories

| Directory     | Purpose |
| ------------- | ------- |
| `backend/`    | Node.js + Express REST API with JSON-file persistence |
| `frontend/`   | React + Vite dashboard for bounty creation and lifecycle |
| `contracts/`  | Soroban (Stellar) contract scaffold for on-chain escrow |
| `docs/`       | All long-form documentation (this file lives here) |
| `scripts/`    | One-off scripts: hashing admin keys, seeding demo data, load testing |
| `playwright/` | End-to-end test specs |
| `.github/`    | CI/CD workflows, issue templates, CODEOWNERS |
| `.husky/`     | Pre-commit hook config (lint-staged) |
| `.vscode/`    | Recommended editor settings |
| `nginx/`      | Reverse proxy config for production deploys |

## Where Do I Find X?

| Looking for | Look in |
| ----------- | ------- |
| API routes | `backend/src/` (entry: `backend/src/index.ts`) |
| OpenAPI spec | `docs/openapi.generated.json` (regen via `npm run gen:openapi` in `backend/`) |
| Backend tests | `backend/test/` |
| Frontend components | `frontend/src/components/`, `frontend/src/pages/` |
| Frontend tests | `frontend/src/**/*.test.tsx` |
| E2E tests | `playwright/` |
| Persistence layer | `backend/src/store.ts` + `backend/data/bounties.json` |
| CI workflows | `.github/workflows/` |
| Issue templates | `.github/ISSUE_TEMPLATE/` |
| Architecture decisions | `docs/adr/` |
| Wave tracking | `docs/wave-4.md`, `docs/wave-5.md`, `docs/wave-6.md` |

## See Also

- `docs/ARCHITECTURE.md` — high-level design overview
- `docs/ARCHITECTURE_DIAGRAM.md` — visual diagram
- `docs/TESTING.md` — test stack
- `docs/LOCAL_DEVELOPMENT.md` — getting started locally
