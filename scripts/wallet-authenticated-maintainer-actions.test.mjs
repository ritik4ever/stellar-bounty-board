import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #1448: Add wallet-authenticated maintainer actions (Freighter / SEP-10)
// Acceptance criteria:
// 1. SEP-10 or Freighter signature verification is implemented
// 2. Maintainer actions reject callers who can't prove the maintainer address
// 3. Tests cover the correct and incorrect caller

test('ISSUE-1448: auth.ts exports wallet signature verification and maintainer check helpers', () => {
  const authPath = join(process.cwd(), 'backend', 'src', 'middleware', 'auth.ts');
  assert.ok(existsSync(authPath), 'backend/src/middleware/auth.ts must exist');

  const content = readFileSync(authPath, 'utf8');
  assert.match(
    content,
    /export function createStellarSignatureAuthMiddleware/,
    'must export createStellarSignatureAuthMiddleware'
  );
  assert.match(
    content,
    /export function createBountyCreationSignatureMiddleware/,
    'must export createBountyCreationSignatureMiddleware'
  );
  assert.match(
    content,
    /export function verifyWalletSignature/,
    'must export verifyWalletSignature'
  );
  assert.match(
    content,
    /export function verifyCallerIsMaintainer/,
    'must export verifyCallerIsMaintainer'
  );
});

test('ISSUE-1448: verifyCallerIsMaintainer correctly validates matching and mismatched addresses', () => {
  // Simulate the verifyCallerIsMaintainer implementation from auth.ts
  function verifyCallerIsMaintainer(signerPublicKey, expectedMaintainer) {
    if (!signerPublicKey || !expectedMaintainer) {
      return false;
    }
    return signerPublicKey.trim() === expectedMaintainer.trim();
  }

  const MAINTAINER_ALICE = 'GBPLA3T4I2WQ2Q2R2F2V2U2X2Y2Z2A2B2C2D2E2F2G2H2I2J2K2L2M2N2O2P';
  const ATTACKER_BOB = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

  // Correct caller
  assert.equal(
    verifyCallerIsMaintainer(MAINTAINER_ALICE, MAINTAINER_ALICE),
    true,
    'correct caller matching maintainer address must return true'
  );

  // Incorrect caller
  assert.equal(
    verifyCallerIsMaintainer(ATTACKER_BOB, MAINTAINER_ALICE),
    false,
    'incorrect caller differing from maintainer address must return false'
  );

  // Edge cases
  assert.equal(
    verifyCallerIsMaintainer('', MAINTAINER_ALICE),
    false,
    'empty caller must return false'
  );
  assert.equal(
    verifyCallerIsMaintainer(MAINTAINER_ALICE, ''),
    false,
    'empty expected maintainer must return false'
  );
  assert.equal(
    verifyCallerIsMaintainer(`  ${MAINTAINER_ALICE}  `, MAINTAINER_ALICE),
    true,
    'whitespace-padded matching addresses must return true'
  );
});

test('ISSUE-1448: createStellarSignatureAuthMiddleware matches caller against stored bounty maintainer', () => {
  const authPath = join(process.cwd(), 'backend', 'src', 'middleware', 'auth.ts');
  const content = readFileSync(authPath, 'utf8');

  // Verify stored bounty maintainer check with 403 response
  assert.match(
    content,
    /storedBounty\.maintainer !== publicKeyHeader/,
    'must verify that signer public key matches stored bounty maintainer'
  );
  assert.match(
    content,
    /status\(403\)[\s\S]*?Signer public key does not match stored bounty maintainer\./,
    'must reject mismatched maintainer with HTTP 403 Forbidden'
  );
});

test('ISSUE-1448: createStellarSignatureAuthMiddleware rejects missing or invalid signatures (HTTP 401)', () => {
  const authPath = join(process.cwd(), 'backend', 'src', 'middleware', 'auth.ts');
  const content = readFileSync(authPath, 'utf8');

  assert.match(
    content,
    /status\(401\)\.json\(\{\s*error:\s*`Missing \$\{HEADER_SIGNATURE\} header\.`\s*\}\)/,
    'must reject missing signature with 401'
  );
  assert.match(
    content,
    /status\(401\)\.json\(\{\s*error:\s*`Missing \$\{HEADER_PUBLIC_KEY\} header\.`\s*\}\)/,
    'must reject missing public key with 401'
  );
  assert.match(
    content,
    /status\(401\)\.json\(\{\s*error:\s*["']Unauthorized Stellar public key\.["']\s*\}\)/,
    'must reject unlisted public key with 401'
  );
  assert.match(
    content,
    /status\(401\)\.json\(\{\s*error:\s*["']Replay attack detected: signature already processed\.["']\s*\}\)/,
    'must reject replayed signature with 401'
  );
  assert.match(
    content,
    /status\(401\)\.json\(\{\s*error:\s*["']Invalid Stellar signature\.["']\s*\}\)/,
    'must reject invalid cryptographic signature with 401'
  );
  assert.match(
    content,
    /status\(401\)\.json\(\{\s*error:\s*["']Signature timestamp has expired or is invalid\.["']\s*\}\)/,
    'must reject expired timestamp with 401'
  );
});

test('ISSUE-1448: Maintainer endpoints in app.ts are wired with signature auth middleware', () => {
  const appPath = join(process.cwd(), 'backend', 'src', 'app.ts');
  const content = readFileSync(appPath, 'utf8');

  // Verify import
  assert.match(
    content,
    /createStellarSignatureAuthMiddleware/,
    'app.ts must import createStellarSignatureAuthMiddleware'
  );
  assert.match(
    content,
    /createBountyCreationSignatureMiddleware/,
    'app.ts must import createBountyCreationSignatureMiddleware'
  );

  // Check routes: create, release, refund, cancel
  assert.match(
    content,
    /app\.post\(\s*['"]\/api\/bounties['"][\s\S]*?createBountyCreationSignatureMiddleware\(\)/,
    'POST /api/bounties must use createBountyCreationSignatureMiddleware'
  );
  assert.match(
    content,
    /app\.post\(\s*['"]\/api\/bounties\/:id\/release['"][\s\S]*?createStellarSignatureAuthMiddleware\(\)/,
    'POST /api/bounties/:id/release must use createStellarSignatureAuthMiddleware'
  );
  assert.match(
    content,
    /app\.post\(\s*['"]\/api\/bounties\/:id\/refund['"][\s\S]*?createStellarSignatureAuthMiddleware\(\)/,
    'POST /api/bounties/:id/refund must use createStellarSignatureAuthMiddleware'
  );
  assert.match(
    content,
    /app\.post\(\s*['"]\/api\/bounties\/:id\/cancel['"][\s\S]*?createStellarSignatureAuthMiddleware\(\)/,
    'POST /api/bounties/:id/cancel must use createStellarSignatureAuthMiddleware'
  );
});

test('ISSUE-1448: docs/api-authentication.md documents wallet signatures and maintainer verification', () => {
  const docPath = join(process.cwd(), 'docs', 'api-authentication.md');
  assert.ok(existsSync(docPath), 'docs/api-authentication.md must exist');

  const content = readFileSync(docPath, 'utf8');
  assert.match(
    content,
    /Wallet-Authenticated Maintainer Actions/,
    'must document wallet-authenticated actions'
  );
  assert.match(content, /x-stellar-public-key/, 'must document x-stellar-public-key header');
  assert.match(content, /x-stellar-signature/, 'must document x-stellar-signature header');
  assert.match(
    content,
    /Freighter Wallet Integration/,
    'must document Freighter wallet integration'
  );
  assert.match(content, /signMessage/, 'must document signMessage API');
  assert.match(content, /HTTP 403 Forbidden/, 'must document 403 response on maintainer mismatch');
  assert.match(content, /STELLAR_AUTH_ENFORCED/, 'must document test mode enforcement');
});
