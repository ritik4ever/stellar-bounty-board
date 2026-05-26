# Security Review Checklist

Use this checklist when reviewing pull requests. Mark each item as addressed or
not applicable in the PR template before merge.

## Input Validation Changed

Review changes that accept user-controlled values and confirm they validate
type, range, length, enum membership, and required fields before data reaches the
store, contract, or external services.

Relevant files and areas:

- `backend/src/validation/`
- `backend/src/app.ts`
- `backend/src/services/bountyStore.ts`
- `frontend/src/`
- `contracts/src/`

## Authentication Or Authorization Changed

Confirm maintainers, contributors, and unauthenticated users can only perform
the actions intended for their role. For Stellar signatures, check replay
protection, message shape, address matching, and failure responses.

Relevant files and areas:

- `backend/src/middleware/auth.ts`
- `backend/src/webhooks/`
- `backend/src/app.ts`
- `frontend/src/wallet.ts`
- `contracts/src/`

## New External Fetch, Webhook, Redirect, Or URL Parsing

Confirm new network behavior cannot fetch private hosts, follow unsafe redirects,
or trust unverified webhook payloads. Validate host allowlists, protocol checks,
timeouts, and signature verification.

Relevant files and areas:

- `backend/src/services/openIssues.ts`
- `backend/src/webhooks/`
- `backend/src/validation/prUrl.ts`
- `frontend/src/api.ts`
- `frontend/src/`

## Dependency Or Third-Party Code Added

Confirm new dependencies are necessary, maintained, pinned through lockfiles, and
covered by the appropriate build or test path. For GitHub Actions and Docker
images, prefer pinned versions and minimum required permissions.

Relevant files and areas:

- `package.json`
- `package-lock.json`
- `backend/package.json`
- `backend/package-lock.json`
- `frontend/package.json`
- `frontend/package-lock.json`
- `.github/workflows/`
- `Dockerfile`
- `docker-compose*.yml`

## Secret Handling Changed

Confirm secrets, private keys, webhook tokens, and API keys are not committed,
logged, sent to the frontend, or exposed in error messages. New environment
variables should be documented without real values.

Relevant files and areas:

- `.env.example`
- `backend/src/logger.ts`
- `backend/src/middleware/`
- `backend/src/webhooks/`
- `frontend/src/`
- `.github/workflows/`

## Reviewer Sign-Off

Before merge, at least one reviewer should confirm that each checked item in the
PR template is either addressed by the diff, verified in tests, or explicitly
not applicable to the change.
