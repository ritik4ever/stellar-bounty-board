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

| Type | Purpose | Example |
|------|---------|---------|
| `feat` | New feature | `feat(frontend): add wallet connection UI` |
| `fix` | Bug fix | `fix(backend): correct bounty status transition logic` |
| `docs` | Documentation only | `docs(CONTRIBUTING): add commit message guide` |
| `test` | Test additions or fixes | `test(contract): add escrow release scenarios` |
| `refactor` | Code refactoring (no behavior change) | `refactor(backend): extract validation to schema` |
| `chore` | Tooling, dependencies, build scripts | `chore(deps): update Express to 4.18` |
| `perf` | Performance improvements | `perf(frontend): memoize bounty list rendering` |
| `ci` | CI/CD pipeline changes | `ci: add GitHub Actions workflow` |

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
- **Can't figure something out?** Open a Discussion or comment on the issue you're working on

We value quality contributions and clear communication. If this guide is missing something, a PR improving it is one of the most valuable contributions you can make.

Happy coding! 🚀
