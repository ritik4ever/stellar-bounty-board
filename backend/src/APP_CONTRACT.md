# app.ts Contract

## Overview

`backend/src/app.ts` creates and configures the Express application instance.
It is imported by `backend/src/index.ts` which calls `app.listen()`.

## Responsibilities

1. **Express app creation** — `export const app = express()`
2. **Middleware registration** — body parser, CORS, rate limiting, logging
3. **Route mounting** — all API routes are mounted here (e.g. `/api/bounties`, `/api/webhooks`)
4. **Error handling** — central error handler catches thrown errors and returns JSON responses

## What app.ts MUST NOT Do

- **Must NOT call `app.listen()`** — that's `index.ts`'s job (allows test runner to import app without binding a port)
- **Must NOT access `process.env` directly** — use `config.ts` instead
- **Must NOT start background jobs** — those are started in `index.ts` (conditional on `NODE_ENV !== "test"`)

## Import Chain

```
index.ts → app.ts → routes/ → services/ → store.ts
```

The import chain is strictly top-down. No circular imports.

<!-- Documented: 2026-10-01 — per issue #1297 -->
