# FAQ

This FAQ covers common contributor and maintainer questions for the Stellar Bounty Board MVP.

## 1. How do I run the project locally?

From the repository root:

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
```

Then open `http://localhost:3000` for the frontend and `http://localhost:3001/api/health` to verify the backend is running.

See also: [README.md](./README.md#run-locally), [ONBOARDING.md](./ONBOARDING.md#5-running-the-project-locally)

## 2. Where is the bounty data stored during local development?

The backend uses file-backed JSON persistence. The active store lives at:

- `backend/data/bounties.json`

Tests can override this with `BOUNTY_STORE_PATH`.

See also: [README.md](./README.md#project-structure), [README.md](./README.md#testing)

## 3. How do I get testnet XLM for wallet and contract testing?

Use Stellar testnet accounts and fund them through the standard Stellar testnet tooling before testing Soroban flows. The repository already links to the Stellar CLI setup used for contract work.

See also: [ONBOARDING.md](./ONBOARDING.md#3-prerequisites), [ONBOARDING.md](./ONBOARDING.md#13-architecture--deployment-links)

## 4. Do I need Freighter to contribute?

Not for normal frontend or backend contributions. Freighter is only relevant if you are testing wallet-related UX or future wallet-authenticated maintainer actions.

See also: [ONBOARDING.md](./ONBOARDING.md#7-where-to-make-common-changes), [ONBOARDING.md](./ONBOARDING.md#14-getting-help)

## 5. Why is my signature or wallet flow not working yet?

The current repository is still an MVP. Wallet-authenticated maintainer actions are listed as a planned upgrade path, not a fully wired feature in the current local flow.

See also: [ONBOARDING.md](./ONBOARDING.md#1-what-is-this-project), [ONBOARDING.md](./ONBOARDING.md#7-where-to-make-common-changes)

## 6. How do I reserve a bounty as a contributor?

Use the reserve route:

```bash
POST /api/bounties/:id/reserve
```

This assigns the bounty to a contributor while the backend tracks the current lifecycle in JSON storage.

See also: [README.md](./README.md#api-overview), [ONBOARDING.md](./ONBOARDING.md#8-understanding-the-api)

## 7. How do I submit a PR link for a reserved bounty?

Use the submit route:

```bash
POST /api/bounties/:id/submit
```

This records the contributor's PR link in the bounty lifecycle.

See also: [README.md](./README.md#api-overview), [ONBOARDING.md](./ONBOARDING.md#8-understanding-the-api)

## 8. How do maintainers release payout or refund escrow?

The MVP exposes two backend actions:

```bash
POST /api/bounties/:id/release
POST /api/bounties/:id/refund
```

`release` pays out to the contributor and `refund` returns the escrow to the maintainer.

See also: [README.md](./README.md#api-overview), [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

## 9. How are expiration and expiry behavior handled?

The current system tracks deadline and status transitions in the backend store and tests. If you are working on expiration behavior, start from the backend lifecycle logic and the existing test suite.

See also: [README.md](./README.md#testing), [ONBOARDING.md](./ONBOARDING.md#9-testing-your-changes)

## 10. How do I reset the local bounty store during development?

Because the MVP uses JSON persistence, the usual local reset path is to clear or replace the contents of `backend/data/bounties.json` in your development environment before restarting the backend.

If you are writing tests, prefer a temporary path via `BOUNTY_STORE_PATH` instead of modifying the shared local file.

See also: [README.md](./README.md#testing), [README.md](./README.md#project-structure)

## 11. Is there a built-in dispute flow?

The project mentions dispute flow as a contributor and maintainer question area, but the current MVP primarily documents release and refund paths. If you are extending dispute handling, review the architecture and contract lifecycle before changing behavior.

See also: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), [ONBOARDING.md](./ONBOARDING.md#1-what-is-this-project)
