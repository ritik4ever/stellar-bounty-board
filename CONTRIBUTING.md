# Contributing

This project is intentionally scoped as an MVP with obvious upgrade paths.

## Run locally

1. Clone the repo and install dependencies:

   ```bash
   npm install
   npm --prefix backend install
   ```

2. Seed demo bounties into the JSON store:

   ```bash
   node scripts/seed-bounties.js
   ```

   This creates 10 deterministic bounties across all statuses (open, reserved, submitted, released, refunded, expired).

   **Flags:**
   - `--count <n>` — control how many bounties to seed (default: 10)
   - `--reset` — wipe existing store before seeding

   Example:

   ```bash
   node scripts/seed-bounties.js --count 5 --reset
   ```

3. Start the backend:

   ```bash
   npm --prefix backend run dev
   ```

4. Start the frontend (in another terminal):
   ```bash
   npm --prefix frontend run dev
   ```

If you want to seed good open-source work quickly:

1. Pick one of the drafts in `docs/issues`.
2. Open it as a GitHub issue with the suggested labels.
3. Tag whether it is `good first issue`, `enhancement`, or `help wanted`.

See the wave backlog documents for organized issue sets:
- [Wave 4](docs/wave-4.md) — 60 issues across frontend, backend, contracts, docs, and DevOps
- [Wave 5](docs/wave-5.md) — 40 issues focusing on security, observability, and polish
- [Wave 6](docs/wave-6.md) — 7 issues for production readiness: database migration, wallet auth, and GitHub integration

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

```
fix(api): reject negative bounty amounts
```

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

## Testing

This project uses Vitest for testing. Tests are organized by type and located in `backend/test/` and `frontend/src/`.

### Running Tests

**Run all tests:**
```bash
npm test
```

**Run a single test file:**
```bash
# From project root
vitest run backend/test/bountyStore.test.ts

# Or from backend directory
cd backend
vitest run test/bountyStore.test.ts
```

**Run tests in watch mode:**
```bash
npm run test:watch
```
Watch mode automatically re-runs tests when files change. Press `q` to quit.

**Generate coverage report:**
```bash
npm run test:coverage
```
This generates:
- Terminal output with coverage percentages
- HTML report at `backend/coverage/index.html`

Open the HTML report in a browser to see detailed line-by-line coverage:
```bash
# On Windows
start backend\coverage\index.html

# On macOS
open backend/coverage/index.html

# On Linux
xdg-open backend/coverage/index.html
```

### Rate Limiting in Test Environment

To facilitate frictionless integration and load testing, strict rate limiting is automatically bypassed when running the application with `NODE_ENV=test`. In production (`NODE_ENV=production`), rate limiting is fully active.

### Test Types

**Unit Tests**
- Test individual functions, classes, or modules in isolation
- Mock external dependencies (Redis, Stellar SDK, file system)
- Fast execution, no network calls
- Examples: `bountyStore.test.ts`, `utils.test.ts`, `cache.test.ts`

**Integration Tests**
- Test interaction between multiple components
- Use real in-memory stores and mocked external services
- Verify API endpoints, middleware, and service integration
- Examples: `api.test.ts`, `githubPrWebhook.test.ts`, `authMiddleware.test.ts`

**End-to-End (E2E) Tests**
- Test complete user workflows across the system
- Simulate real user interactions with GitHub webhooks, Stellar transactions
- Currently minimal; expand as needed for critical paths
- Future: Playwright or Cypress for frontend E2E

### Writing Test Fixtures

Test fixtures are shared test data in `backend/test/fixtures.ts`. Add new fixtures when:

- You need consistent test data across multiple test files
- Validating complex schemas (e.g., Stellar public keys, bounty payloads)
- Avoiding repetition in test setup

**Example fixture usage:**
```typescript
import { MAINTAINER, CONTRIBUTOR, validCreateBody } from "./fixtures";

it("creates a bounty with fixture data", async () => {
  const bounty = await createBounty({
    ...validCreateBody,
    maintainer: MAINTAINER,
  });
  expect(bounty.maintainer).toBe(MAINTAINER);
});
```

**Guidelines for fixtures:**
- Export constants for reusable values (addresses, tokens)
- Export valid request bodies matching Zod schemas
- Keep fixtures minimal but realistic
- Document any assumptions (e.g., "valid Stellar-style public keys")

### Test Patterns

**Arrange-Act-Assert:**
```typescript
it("reserves a bounty", async () => {
  // Arrange
  const bounty = await createBounty(validCreateBody);
  
  // Act
  const reserved = await reserveBounty(bounty.id, CONTRIBUTOR);
  
  // Assert
  expect(reserved.status).toBe("reserved");
  expect(reserved.contributor).toBe(CONTRIBUTOR);
});
```

**Error handling:**
```typescript
it("throws when bounty not found", async () => {
  await expect(reserveBounty("BNT-9999", CONTRIBUTOR))
    .rejects.toThrow(/not found/i);
});
```

**Cleanup with beforeEach/afterEach:**
```typescript
beforeEach(() => {
  // Setup: create temp file, reset modules
  storeFile = path.join(os.tmpdir(), `test-${randomUUID()}.json`);
  vi.resetModules();
});

afterEach(() => {
  // Teardown: delete temp files
  fs.unlinkSync(storeFile);
});
```

### Coverage Goals

- Aim for >80% coverage on new code
- Focus coverage on business logic (bountyStore, API handlers)
- Don't obsess over 100% coverage for trivial code
- Use coverage reports to identify untested edge cases

## Writing Soroban Contract Tests

Contract tests live in `contracts/src/test.rs`. They run with `cargo test` and use the `testutils` feature from the `soroban-sdk` crate. The following conventions mirror those already used in `contracts/src/test.rs`.

### Test environment setup

Every test starts with a fresh `Env` and usually enables mocked authorizations:

```rust
let env = Env::default();
env.mock_all_auths();
```

`mock_all_auths()` lets contract calls succeed without real Stellar signatures during unit tests. `setup_test(&env)` (defined in `test.rs`) registers the contract, generates actor addresses, creates a Stellar asset token, and initializes the contract:

```rust
let (client, maintainer, contributor, token_id, _fee_recipient, _arbiter) = setup_test(&env);
```

- Use `Address::generate(&env)` to create new test accounts.
- Use `env.register_stellar_asset_contract_v2(token_admin)` to create a mock token.
- Use `soroban_sdk::token::StellarAssetClient` to mint tokens to actors.
- Use `soroban_sdk::token::Client` (aliased as `TokenClient` in `lib.rs`) to inspect balances.

### Ledger time manipulation

Time-dependent tests rely on the test ledger. Read the current timestamp with `env.ledger().timestamp()` and jump forward with `env.ledger().set_timestamp(...)`:

```rust
let deadline = env.ledger().timestamp() + 1000;

// later, simulate the deadline passing
env.ledger().set_timestamp(deadline + 1);
```

### Example: create and release a bounty

This test walks through the happy path used across `test.rs`: create a bounty, reserve it, submit it, then release it. Add it to `contracts/src/test.rs` after the existing `use super::*;` block so `Env`, `BountyStatus`, `String`, and `TokenClient` stay in scope.

```rust
#[test]
fn test_create_and_release_bounty_example() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, contributor, token_id, _fee_recipient, _arbiter) = setup_test(&env);

    // Fund the maintainer so they can create the bounty.
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    // 1. Create a bounty.
    let deadline = env.ledger().timestamp() + 1000;
    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "ritik4ever/stellar-bounty-board"),
        &1,
        &String::from_str(&env, "Fix docs"),
        &deadline,
        &0u32,
    );

    // 2. Contributor reserves the work.
    client.reserve_bounty(&bounty_id, &contributor);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Reserved);

    // 3. Contributor submits the work.
    client.submit_bounty(&bounty_id, &contributor);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Submitted);

    // 4. Maintainer releases the payout.
    client.release_bounty(&bounty_id, &maintainer);
    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.status, BountyStatus::Released);

    // 5. Verify balances (0% fee means contributor gets the full amount).
    let token = TokenClient::new(&env, &token_id);
    assert_eq!(token.balance(&contributor), 500);
    assert_eq!(token.balance(&client.address), 0);
}
```

Key points from this example:

- `String::from_str(&env, ...)` wraps Rust strings in Soroban `String` types.
- `client.create_bounty(...)` returns the new `bounty_id` and pulls the bounty amount from the maintainer into escrow.
- `reserve_bounty` and `submit_bounty` must be called by the contributor.
- `release_bounty` must be called by the maintainer.

### Testing expected failures

Use `#[should_panic(expected = "...")]` when a call should fail with a specific error message:

```rust
#[test]
#[should_panic(expected = "BountyMustBeSubmitted")]
fn test_release_before_submit() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, maintainer, contributor, token_id, _, _) = setup_test(&env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&maintainer, &1000);

    let bounty_id = client.create_bounty(
        &maintainer,
        &token_id,
        &500,
        &String::from_str(&env, "repo"),
        &1,
        &String::from_str(&env, "title"),
        &(env.ledger().timestamp() + 1000),
        &0u32,
    );

    client.reserve_bounty(&bounty_id, &contributor);
    client.release_bounty(&bounty_id, &maintainer); // panics because not Submitted
}
```

### Running the contract test suite

From the `contracts/` directory:

```bash
cd contracts
cargo test
```

Run a single test by name:

```bash
cargo test test_create_and_release_bounty_example
```

Show output from panics and prints:

```bash
cargo test -- --nocapture
```

Run the contract linter:

```bash
cargo clippy
```

#### Interpreting failures

- **Compilation errors** usually mean a type mismatch (e.g., missing `&` on an argument, using `String` instead of `soroban_sdk::String`, or forgetting `u32`/`i128` suffixes).
- **`should_panic` failures** happen when the panic message does not contain the expected string or the call succeeds when it should panic.
- **`assert_eq!` failures** show the left vs. right value. Double-check the ledger timestamp if a bounty expired or was not yet eligible for refund.
- **Auth failures** mean `env.mock_all_auths()` was not called before a function that uses `require_auth`.

### Further reading

- [Soroban contract testing fundamentals](https://soroban.stellar.org/docs/fundamentals-and-concepts/testing)
- [Stellar docs: Writing tests for Soroban contracts](https://developers.stellar.org/docs/build/smart-contracts/testing)
- [soroban-sdk `testutils` API reference (v25.3.1)](https://docs.rs/soroban-sdk/25.3.1/soroban_sdk/testutils/index.html)

## Pre-Commit Hooks

This project uses Husky and lint-staged to automatically run linting, formatting, and type-checking on staged files before each commit.

### What Gets Checked

When you commit changes, the following checks run on staged `.ts` and `.tsx` files:

1. **TypeScript type-check** - Catches type errors before runtime
2. **ESLint** - Enforces code style and catches potential bugs
3. **Prettier** - Formats code consistently

The commit is blocked if any check fails.

### Setup

The hooks are automatically installed when you run:

```bash
npm install
```

This runs the `prepare` script which executes `husky install`, setting up the Git hooks.

### Platform-Specific Setup

**Linux/macOS:**
```bash
# Hooks work out of the box after npm install
git add .
git commit -m "feat: add feature"
# Hooks run automatically
```

**Windows (WSL2):**
```bash
# Ensure Git is installed in WSL2, not just Windows
sudo apt update
sudo apt install git

# Install dependencies
npm install

# Hooks should work normally
git add .
git commit -m "feat: add feature"
```

**Windows (native Git):**
If using native Git for Windows instead of WSL2:
```bash
# Install dependencies
npm install

# Hooks should work with Git Bash or PowerShell
git add .
git commit -m "feat: add feature"
```

### Bypassing Hooks (Not Recommended)

If you need to bypass hooks temporarily (e.g., emergency fix):

```bash
git commit --no-verify -m "emergency fix"
```

Use sparingly and only for legitimate emergencies.

### Troubleshooting

**Hooks not running:**
```bash
# Reinstall Husky
npm run prepare

# Verify hooks are installed
ls .husky/pre-commit
```

**TypeScript errors on commit:**
```bash
# Run type-check manually to see full error details
cd frontend && npx tsc --noEmit
cd backend && npx tsc --noEmit
```

**ESLint errors:**
```bash
# Run ESLint manually with auto-fix
npx eslint frontend/src/**/*.{ts,tsx} --fix
npx eslint backend/src/**/*.ts --fix
```

**WSL2 permission issues:**
```bash
# Ensure .husky/pre-commit is executable
chmod +x .husky/pre-commit
```

### Configuration Files

- `.lintstagedrc.json` - Defines which files to check and which commands to run
- `.eslintrc.json` - ESLint configuration
- `.prettierrc.json` - Prettier formatting rules
- `.prettierignore` - Files to exclude from Prettier

## Getting Help

- **New to the project?** Start with [ONBOARDING.md](./ONBOARDING.md)
- **Stuck on a specific feature?** [Read the architecture docs](./docs/ARCHITECTURE.md)
- **Local webhook testing?** [ngrok setup guide](./docs/webhook-signatures.md)
- **For common issues or troubleshooting steps** [FAQ Guide](./docs/FAQ.md)


- **Can't figure something out?** Open a Discussion or comment on the issue you're working on

We value quality contributions and clear communication. If this guide is missing something, a PR improving it is one of the most valuable contributions you can make.

Happy coding! 🚀
