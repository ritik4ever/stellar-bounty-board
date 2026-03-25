# Architecture

This document describes the system architecture of Stellar Bounty Board, including component relationships and the bounty lifecycle flow.

## System Overview

```
                         Stellar Bounty Board Architecture
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                        Frontend (React + Vite)                          │   │
│   │                           localhost:3000                                │   │
│   │                                                                         │   │
│   │  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐    │   │
│   │  │   Bounty     │   │   Create     │   │    Open Issues           │    │   │
│   │  │   Dashboard  │   │   Form       │   │    Browser               │    │   │
│   │  └──────────────┘   └──────────────┘   └──────────────────────────┘    │   │
│   │                                                                         │   │
│   │                         api.ts (fetch client)                           │   │
│   └─────────────────────────────────┬───────────────────────────────────────┘   │
│                                     │                                           │
│                                     │ HTTP/JSON                                 │
│                                     │ /api/*                                    │
│                                     ▼                                           │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                       Backend (Express + Node.js)                       │   │
│   │                           localhost:3001                                │   │
│   │                                                                         │   │
│   │  ┌─────────────────────────────────────────────────────────────────┐   │   │
│   │  │                        REST API Routes                          │   │   │
│   │  │                                                                 │   │   │
│   │  │  GET  /api/health          POST /api/bounties/:id/reserve       │   │   │
│   │  │  GET  /api/bounties        POST /api/bounties/:id/submit        │   │   │
│   │  │  POST /api/bounties        POST /api/bounties/:id/release       │   │   │
│   │  │  GET  /api/open-issues     POST /api/bounties/:id/refund        │   │   │
│   │  └─────────────────────────────────────────────────────────────────┘   │   │
│   │                                     │                                   │   │
│   │              ┌──────────────────────┼──────────────────────┐            │   │
│   │              ▼                      ▼                      ▼            │   │
│   │     ┌──────────────┐      ┌──────────────┐      ┌──────────────┐       │   │
│   │     │ Zod Schema   │      │ bountyStore  │      │ openIssues   │       │   │
│   │     │ Validation   │      │ Service      │      │ Service      │       │   │
│   │     └──────────────┘      └──────┬───────┘      └──────────────┘       │   │
│   │                                  │                                      │   │
│   └──────────────────────────────────┼──────────────────────────────────────┘   │
│                                      │                                          │
│                                      │ File I/O                                 │
│                                      ▼                                          │
│                          ┌────────────────────────┐                             │
│                          │  backend/data/         │                             │
│                          │  bounties.json         │                             │
│                          └────────────────────────┘                             │
│                                                                                  │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ On-Chain (Future) ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                     Soroban Smart Contract (Rust)                       │   │
│   │                                                                         │   │
│   │  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐    │   │
│   │  │   Escrow     │   │   Payout     │   │  Contract Events         │    │   │
│   │  │   Deposit    │   │   Release    │   │  (Bounty lifecycle)      │    │   │
│   │  └──────────────┘   └──────────────┘   └──────────────────────────┘    │   │
│   │                                                                         │   │
│   │  Methods: create_bounty, reserve_bounty, submit_bounty,                │   │
│   │           release_bounty, refund_bounty, get_bounty                    │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### Frontend (`frontend/`)

React + Vite application serving as the maintainer and contributor dashboard.

| File | Responsibility |
|------|----------------|
| `src/App.tsx` | Main dashboard component, bounty list and action buttons |
| `src/api.ts` | HTTP client wrapping all backend API calls |
| `src/types.ts` | TypeScript interfaces (`Bounty`, `BountyStatus`, `OpenIssue`) |
| `vite.config.ts` | Dev server config with API proxy to backend |

### Backend (`backend/`)

Express REST API managing bounty state with JSON file persistence.

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Express app, route handlers, middleware setup |
| `src/services/bountyStore.ts` | CRUD operations, status transitions, file I/O |
| `src/services/openIssues.ts` | Serves contribution-ready issue drafts |
| `src/validation/schemas.ts` | Zod schemas for request validation |
| `src/utils.ts` | Rate limiter and helpers |
| `data/bounties.json` | Persistent bounty storage |

### Smart Contract (`contracts/`)

Soroban contract implementing on-chain escrow logic for trustless bounty payouts.

| Element | Purpose |
|---------|---------|
| `BountyStatus` enum | Open, Reserved, Submitted, Released, Refunded, Expired |
| `Bounty` struct | On-chain bounty record with maintainer, contributor, token, amount |
| `create_bounty` | Transfers tokens from maintainer to contract escrow |
| `reserve_bounty` | Locks bounty to a specific contributor |
| `submit_bounty` | Marks work submitted (links PR off-chain) |
| `release_bounty` | Pays out escrowed tokens to contributor |
| `refund_bounty` | Returns escrowed tokens to maintainer |
| Contract events | Emitted on each state transition for indexers |

## Bounty Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Bounty Lifecycle                                   │
└─────────────────────────────────────────────────────────────────────────────────┘

                                  MAINTAINER
                                      │
                                      │ 1. Create Bounty
                                      │    (fund escrow)
                                      ▼
                              ┌───────────────┐
                              │     OPEN      │◀─────────────────────┐
                              └───────┬───────┘                      │
                                      │                              │
          ┌───────────────────────────┼───────────────────────────┐  │
          │                           │                           │  │
          │ (deadline passes)         │ 2. Reserve                │  │ (deadline
          ▼                           │    (contributor claims)   │  │  passes)
  ┌───────────────┐                   ▼                           │  │
  │   EXPIRED     │           ┌───────────────┐                   │  │
  └───────────────┘           │   RESERVED    │───────────────────┘  │
                              └───────┬───────┘                      │
                                      │                              │
                                      │ 3. Submit                    │
                                      │    (link PR)                 │
                                      ▼                              │
                              ┌───────────────┐                      │
                              │   SUBMITTED   │                      │
                              └───────┬───────┘                      │
                                      │                              │
          ┌───────────────────────────┴───────────────────┐          │
          │                                               │          │
          │ 4a. Release                                   │ 4b. Refund
          │     (payout to contributor)                   │     (return to maintainer)
          ▼                                               ▼          │
  ┌───────────────┐                               ┌───────────────┐  │
  │   RELEASED    │                               │   REFUNDED    │◀─┘
  │   (tokens     │                               │   (tokens     │
  │    paid out)  │                               │    returned)  │
  └───────────────┘                               └───────────────┘


  ─────────────────────────────────────────────────────────────────────────────
  State Transition Rules:

  OPEN       → RESERVED   : Any contributor can claim
  OPEN       → EXPIRED    : Deadline passes without reservation
  OPEN       → REFUNDED   : Maintainer cancels before any claim
  RESERVED   → SUBMITTED  : Reserved contributor submits PR link
  RESERVED   → EXPIRED    : Deadline passes without submission
  RESERVED   → REFUNDED   : Maintainer cancels (no submission yet)
  SUBMITTED  → RELEASED   : Maintainer approves, funds paid out
  SUBMITTED  → (no refund): Submitted bounties must be reviewed
  ─────────────────────────────────────────────────────────────────────────────
```

## Data Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Request/Response Flow                                │
└──────────────────────────────────────────────────────────────────────────────┘

1. CREATE BOUNTY
   ┌──────────┐      POST /api/bounties       ┌──────────┐
   │ Frontend │ ────────────────────────────▶ │ Backend  │
   │          │      { repo, title, amount }  │          │
   │          │                               │          │
   │          │ ◀──────────────────────────── │          │
   │          │      { data: BountyRecord }   │          │
   └──────────┘                               └────┬─────┘
                                                   │
                                                   ▼ writes
                                            ┌─────────────┐
                                            │bounties.json│
                                            └─────────────┘

2. RESERVE BOUNTY
   ┌──────────┐   POST /api/bounties/:id/reserve   ┌──────────┐
   │ Frontend │ ─────────────────────────────────▶ │ Backend  │
   │          │   { contributor: "G..." }          │          │
   │          │                                    │          │
   │          │ ◀───────────────────────────────── │          │
   │          │   { data: { status: "reserved" }}  │          │
   └──────────┘                                    └──────────┘

3. SUBMIT WORK
   ┌──────────┐   POST /api/bounties/:id/submit    ┌──────────┐
   │ Frontend │ ─────────────────────────────────▶ │ Backend  │
   │          │   { contributor, submissionUrl }   │          │
   │          │                                    │          │
   │          │ ◀───────────────────────────────── │          │
   │          │   { data: { status: "submitted" }} │          │
   └──────────┘                                    └──────────┘

4. RELEASE / REFUND
   ┌──────────┐   POST /api/bounties/:id/release   ┌──────────┐
   │ Frontend │ ─────────────────────────────────▶ │ Backend  │
   │          │   { maintainer: "G..." }           │          │
   │          │                                    │          │
   │          │ ◀───────────────────────────────── │          │
   │          │   { data: { status: "released" }}  │          │
   └──────────┘                                    └──────────┘


┌──────────────────────────────────────────────────────────────────────────────┐
│                        On-Chain Flow (Future)                                │
└──────────────────────────────────────────────────────────────────────────────┘

   ┌──────────┐                        ┌──────────────────┐
   │  Wallet  │   1. Sign & submit     │  Soroban         │
   │ (Freighter│ ─────────────────────▶│  Contract        │
   │  etc.)   │                        │                  │
   └──────────┘                        │  Escrow holds    │
                                       │  XLM/tokens      │
                                       └────────┬─────────┘
                                                │
                        On release:             │
                        Token transfer ─────────┴───────▶ Contributor wallet
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Deployment Options                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Local Development:
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  npm run        │     │  npm run        │     │  cargo build    │
│  dev:frontend   │     │  dev:backend    │     │  (contracts)    │
│  :3000          │────▶│  :3001          │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘

Production (example):
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Vercel/        │     │  Railway/       │     │  Stellar        │
│  Netlify        │────▶│  Render         │     │  Testnet/       │
│  (static)       │     │  (Node.js API)  │     │  Mainnet        │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                        ┌─────────────────┐
                        │  PostgreSQL     │  (future: replace JSON file)
                        │  + Redis cache  │
                        └─────────────────┘
```

## Directory Structure

```
stellar-bounty-board/
├── frontend/                    # React + Vite dashboard
│   ├── src/
│   │   ├── App.tsx             # Main bounty UI
│   │   ├── api.ts              # Backend API client
│   │   ├── types.ts            # TypeScript interfaces
│   │   └── main.tsx            # Entry point
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                     # Express REST API
│   ├── src/
│   │   ├── index.ts            # Routes and server
│   │   ├── services/
│   │   │   ├── bountyStore.ts  # Bounty CRUD + persistence
│   │   │   └── openIssues.ts   # Issue drafts service
│   │   ├── validation/
│   │   │   └── schemas.ts      # Zod request schemas
│   │   └── utils.ts            # Rate limiting
│   ├── data/
│   │   └── bounties.json       # JSON persistence
│   └── package.json
│
├── contracts/                   # Soroban smart contract
│   ├── src/
│   │   └── lib.rs              # Escrow logic
│   ├── Cargo.toml
│   └── Cargo.lock
│
├── docs/
│   ├── ARCHITECTURE.md         # This file
│   └── issues/                 # Draft issues for contributors
│
├── README.md
├── CONTRIBUTING.md
├── ONBOARDING.md
└── package.json                # Root workspace scripts
```
