# Contributing

This project is intentionally scoped as an MVP with obvious upgrade paths.

If you want to seed good open-source work quickly:

1. Pick one of the drafts in `docs/issues`.
2. Open it as a GitHub issue with the suggested labels.
3. Tag whether it is `good first issue`, `enhancement`, or `help wanted`.

High-value contribution areas:

- Wallet-authenticated payout flow
- GitHub App or webhook integration
- Soroban event indexing
- Persistent relational storage
- CI and integration tests.

## Conventional Commits

We follow the [Conventional Commits](https://www.conventionalcommits.org/) standard to keep the commit history clear and enable automated changelog generation.

### Commit Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Rules:**

- Keep `<subject>` under 50 characters, lowercase, no period
- Use imperative mood ("add" not "added")
- The `(<scope>)` is optional but recommended for clarity

### Commit Types

| Type       | Purpose                               | Example                                                |
| ---------- | ------------------------------------- | ------------------------------------------------------ |
| `feat`     | New feature                           | `feat(frontend): add wallet connection UI`             |
| `fix`      | Bug fix                               | `fix(backend): correct bounty status transition logic` |
| `docs`     | Documentation only                    | `docs(CONTRIBUTING): add commit message guide`         |
| `test`     | Test additions or fixes               | `test(contract): add escrow release scenarios`         |
| `refactor` | Code refactoring (no behavior change) | `refactor(backend): extract validation to schema`      |
| `chore`    | Tooling, dependencies, build scripts  | `chore(deps): update Express to 4.18`                  |
| `perf`     | Performance improvements              | `perf(frontend): memoize bounty list rendering`        |
| `ci`       | CI/CD pipeline changes                | `ci: add GitHub Actions workflow`                      |

### Examples

**Good:**

```
feat(contract): implement release_bounty escrow transfer

Add on-chain token transfer logic when maintainer approves
bounty release. Validates contributor address and contract
balance before transfer.

Closes #42
```

**Also good (for simple changes):**

```text
fix(api): reject negative bounty amounts
```

## Testing

Add or update tests with the smallest scope that proves the behavior you changed. Unit tests should cover pure helpers, validation rules, and status transitions. Integration tests should cover API routes, service interactions, and persistence behavior. End-to-end tests should be reserved for complete user journeys that need the frontend, backend, and browser together.

### Running Tests

From the repository root:

```bash
npm test
```

This runs the backend Vitest suite through the root `test` script. To keep the full workspace healthy, also run the frontend or package-specific commands when your change touches those areas.

Note: in a fresh checkout, unrelated backend tests may currently fail around reservation expiration, auth status codes, API amount validation, and webhook timeout behavior. Treat those as existing suite issues unless your PR changes the affected paths.

To run a single backend test file:

```bash
npm --prefix backend exec -- vitest run test/bountyStore.test.ts
```

To run tests in watch mode from the repository root:

```bash
npm run test:watch
```

To generate a coverage report:

```bash
npm run test:coverage
```

Vitest prints a summary in the terminal and writes the HTML report under `backend/coverage/`. Open `backend/coverage/index.html` to inspect uncovered lines and branches. Treat low or missing coverage on code you changed as a signal to add targeted tests before opening a PR.

### Writing Tests

- Put backend tests under `backend/test/` and keep file names close to the code under test.
- Reuse shared fixtures from `backend/test/fixtures.ts` for common bounty, submission, user, and repository data.
- Add new fixtures only when several tests need the same setup. Keep one-off values inside the test so the scenario stays readable.
- Prefer deterministic dates, IDs, and amounts. Avoid depending on the current clock unless the behavior being tested is time-sensitive.
- Cover success and failure paths for validation, state transitions, and API responses.

Prefer unit tests for utilities such as date helpers, amount formatting, and schema validation. Use integration tests when a route or service needs to prove request handling, storage updates, or cross-module behavior. Reserve end-to-end tests for user-facing flows that cannot be verified confidently at a lower level.

## Pull Request Checklist

Before submitting a PR, verify:

- [ ] **Branch created from `main`** — keep it focused on one issue
- [ ] **PR title follows conventional commits** — e.g., `feat(frontend): add wallet support`
- [ ] **Tests pass locally**
  - Frontend: `npm run lint && npm run build` (in `frontend/`)
  - Backend: `npm run lint && npm run build` (in `backend/`)
  - Contract: `cargo test && cargo clippy` (in `contracts/`)
- [ ] **No TypeScript errors** — `npm run build` catches them
- [ ] **No debug code left behind**
  - No `console.log()`, `console.debug()`, `console.warn()`
  - No `// TODO` comments without an associated issue
- [ ] **Documentation updated** (if applicable)
  - API changes? Update `ONBOARDING.md` or in-code JSDoc
  - New feature? Add example to the relevant doc or README
  - Architecture change? Update `docs/ARCHITECTURE.md`
- [ ] **Commits use conventional format** — squash if needed
- [ ] **PR description** includes:
  - What changed and why
  - How to test/verify the change
  - Link to related issue(s): `Closes #<issue-number>`

## Getting Help

- **New to the project?** Start with [ONBOARDING.md](./ONBOARDING.md)
- **Stuck on a specific feature?** [Read the architecture docs](./docs/ARCHITECTURE.md)
- **Local webhook testing?** [ngrok setup guide](./docs/webhook-signatures.md)
- **Can't figure something out?** Open a Discussion or comment on the issue you're working on

We value quality contributions and clear communication. If this guide is missing something, a PR improving it is one of the most valuable contributions you can make.

Happy coding! 🚀
