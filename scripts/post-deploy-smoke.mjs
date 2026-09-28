#!/usr/bin/env node
/**
 * Post-deploy smoke test (#1466).
 *
 * A platform's own "build succeeded" signal proves nothing about the running
 * app: the process can boot and then fail to answer, or answer while its
 * dependencies (bounty store, Soroban RPC, contract, auth config) are
 * unreachable. This script is the missing end-to-end check. It is run after a
 * deploy by `.github/workflows/post-deploy-smoke.yml`; a non-zero exit fails
 * that workflow, which marks the commit's check failed and keeps the deploy
 * from being treated as successful.
 *
 * Checks performed, against the *live* deployments:
 *
 *   1. Backend liveness  - GET {BACKEND_BASE_URL}/api/health returns 200.
 *   2. Backend readiness - GET {BACKEND_BASE_URL}/api/health/deep returns 200
 *      with `overall: "up"` and every component (`store`, `soroban`,
 *      `contract`, `auth`) reporting `up`. A 503 with `overall: "down"` fails,
 *      and the failing components are printed.
 *   3. Frontend root     - GET {FRONTEND_BASE_URL}/ returns 200, an HTML
 *      content type, and the built SPA shell (`<div id="root">` plus a module
 *      script tag and the page title). A Vercel "deployment not found" page or
 *      a blank shell fails.
 *
 * Usage:
 *
 *   node scripts/post-deploy-smoke.mjs
 *
 * Environment variables:
 *
 *   BACKEND_BASE_URL    required - e.g. https://stellar-bounty-board-api.onrender.com
 *   FRONTEND_BASE_URL   required - e.g. https://stellar-bounty-board.vercel.app
 *   SMOKE_ATTEMPTS      optional - attempts per check before failing (default 10)
 *   SMOKE_DELAY_MS      optional - delay between attempts in ms (default 15000)
 *   SMOKE_TIMEOUT_MS    optional - per-request timeout in ms (default 10000)
 *
 * Attempts exist because a freshly promoted deploy can take a moment to accept
 * traffic (Render cold starts, Vercel alias propagation). Retries are bounded,
 * so a genuinely broken deployment still fails the job.
 *
 * Exit codes:
 *   0 - every check passed
 *   1 - at least one check failed
 *   2 - the script was misconfigured (missing or invalid environment)
 *
 * Requirements: Node 18+ (global `fetch`). No dependencies.
 */

const DEFAULTS = {
  attempts: 10,
  delayMs: 15_000,
  timeoutMs: 10_000,
};

const ATTEMPTS = positiveInt(process.env.SMOKE_ATTEMPTS, DEFAULTS.attempts);
const DELAY_MS = nonNegativeInt(process.env.SMOKE_DELAY_MS, DEFAULTS.delayMs);
const TIMEOUT_MS = positiveInt(process.env.SMOKE_TIMEOUT_MS, DEFAULTS.timeoutMs);

/** Parse a positive integer env var, falling back to `fallback` when unusable. */
function positiveInt(raw, fallback) {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Parse a non-negative integer env var, falling back to `fallback` when unusable. */
function nonNegativeInt(raw, fallback) {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalize a base URL: trim trailing slashes so paths can be appended safely.
 * Returns `null` for anything that is not an absolute http(s) URL.
 */
function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

const BACKEND_BASE_URL = normalizeBaseUrl(process.env.BACKEND_BASE_URL);
const FRONTEND_BASE_URL = normalizeBaseUrl(process.env.FRONTEND_BASE_URL);

/**
 * Perform one HTTP GET.
 *
 * Never throws: transport and timeout failures come back as
 * `{ ok: false, error }` so callers can decide whether to retry.
 */
async function fetchOnce(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'stellar-bounty-board-post-deploy-smoke' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.text();
    return { ok: true, status: response.status, contentType: response.headers.get('content-type') ?? '', body };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Run `check` until it reports success or the attempt budget is exhausted.
 * Returns the last result plus the number of attempts made.
 */
async function withRetries(label, check) {
  let last = { passed: false, detail: 'no attempt was made' };

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    last = await check();
    if (last.passed) {
      return { ...last, attempts: attempt };
    }
    if (attempt < ATTEMPTS) {
      console.log(`[retry] ${label}: ${last.detail} (attempt ${attempt}/${ATTEMPTS}); retrying in ${DELAY_MS}ms`);
      await sleep(DELAY_MS);
    }
  }

  return { ...last, attempts: ATTEMPTS };
}

/** Check 1 - backend liveness. */
async function checkBackendLiveness(baseUrl) {
  return withRetries('backend liveness', async () => {
    const result = await fetchOnce(`${baseUrl}/api/health`);

    if (!result.ok) {
      return { passed: false, detail: `request failed: ${result.error}` };
    }
    if (result.status !== 200) {
      return { passed: false, detail: `expected HTTP 200, got ${result.status}` };
    }

    let payload;
    try {
      payload = JSON.parse(result.body);
    } catch {
      return { passed: false, detail: 'response was not valid JSON' };
    }
    if (payload?.status !== 'ok') {
      return { passed: false, detail: `expected {"status":"ok"}, got ${JSON.stringify(payload)}` };
    }

    return { passed: true, detail: 'HTTP 200 with status "ok"' };
  });
}

/**
 * Check 2 - backend readiness, including its dependencies.
 *
 * This is the check that catches "the process booted but the bounty store,
 * Soroban RPC, contract or auth config is unreachable" - the exact failure a
 * build-success-only pipeline cannot see.
 */
async function checkBackendDeepHealth(baseUrl) {
  return withRetries('backend readiness', async () => {
    const result = await fetchOnce(`${baseUrl}/api/health/deep`);

    if (!result.ok) {
      return { passed: false, detail: `request failed: ${result.error}` };
    }

    let payload;
    try {
      payload = JSON.parse(result.body);
    } catch {
      return { passed: false, detail: `expected JSON, got HTTP ${result.status}: ${result.body.slice(0, 120)}` };
    }

    const components = payload?.components && typeof payload.components === 'object' ? payload.components : {};
    const down = Object.entries(components)
      .filter(([, state]) => state !== 'up')
      .map(([name, state]) => `${name}=${state}`);

    if (result.status !== 200 || payload?.overall !== 'up' || down.length > 0) {
      const detail =
        down.length > 0
          ? `HTTP ${result.status}, overall=${payload?.overall ?? 'missing'}, down: ${down.join(', ')}`
          : `HTTP ${result.status}, overall=${payload?.overall ?? 'missing'}`;
      return { passed: false, detail };
    }

    const names = Object.keys(components);
    return {
      passed: true,
      detail: `HTTP 200, overall=up${names.length ? ` (${names.join(', ')} all up)` : ''}`,
    };
  });
}

/** Check 3 - frontend root page actually serves the built app. */
async function checkFrontendRoot(baseUrl) {
  return withRetries('frontend root page', async () => {
    const result = await fetchOnce(`${baseUrl}/`);

    if (!result.ok) {
      return { passed: false, detail: `request failed: ${result.error}` };
    }
    if (result.status !== 200) {
      return { passed: false, detail: `expected HTTP 200, got ${result.status}` };
    }
    if (!/text\/html/i.test(result.contentType)) {
      return { passed: false, detail: `expected an HTML content type, got "${result.contentType}"` };
    }

    const body = result.body ?? '';
    const missing = [];
    if (!/<div[^>]+id=["']root["']/i.test(body)) missing.push('<div id="root">');
    // The production bundle is hashed (`/assets/index-<hash>.js`), so only the
    // script *type* is asserted - not the dev-only `/src/main.tsx` path.
    if (!/<script[^>]+type=["']module["']/i.test(body)) missing.push('a module script tag');
    if (!/<title>[^<]*Stellar Bounty Board/i.test(body)) missing.push('the page title');
    if (/deployment not found|DEPLOYMENT_NOT_FOUND/i.test(body)) missing.push('no "deployment not found" page');

    if (missing.length > 0) {
      return { passed: false, detail: `served HTML is missing: ${missing.join(', ')}` };
    }

    return { passed: true, detail: `HTTP 200, HTML shell served (${body.length} bytes)` };
  });
}

async function main() {
  if (!BACKEND_BASE_URL || !FRONTEND_BASE_URL) {
    const missing = [];
    if (!BACKEND_BASE_URL) missing.push('BACKEND_BASE_URL');
    if (!FRONTEND_BASE_URL) missing.push('FRONTEND_BASE_URL');
    console.error(
      `[fail] ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing or not an absolute http(s) URL.\n` +
        '       Set the repository variables/inputs (see docs/deployment.md, "Post-deploy smoke test") and re-run.'
    );
    process.exit(2);
  }

  console.log(`Post-deploy smoke test (#1466)`);
  console.log(`  backend  : ${BACKEND_BASE_URL}`);
  console.log(`  frontend : ${FRONTEND_BASE_URL}`);
  console.log(`  policy   : up to ${ATTEMPTS} attempts, ${DELAY_MS}ms apart, ${TIMEOUT_MS}ms per request\n`);

  const results = [
    ['Backend liveness  /api/health', await checkBackendLiveness(BACKEND_BASE_URL)],
    ['Backend readiness /api/health/deep', await checkBackendDeepHealth(BACKEND_BASE_URL)],
    ['Frontend root     /', await checkFrontendRoot(FRONTEND_BASE_URL)],
  ];

  let failed = 0;
  for (const [label, result] of results) {
    const marker = result.passed ? '[ok]  ' : '[FAIL]';
    if (!result.passed) failed += 1;
    console.log(`${marker} ${label} - ${result.detail} (attempts: ${result.attempts})`);
  }

  if (failed > 0) {
    console.error(
      `\n[fail] ${failed} of ${results.length} post-deploy checks failed. The deploy is NOT verified; ` +
        'check the platform logs and docs/deployment.md before retrying.'
    );
    process.exit(1);
  }

  console.log(`\n[ok] All ${results.length} post-deploy checks passed.`);
}

await main();
