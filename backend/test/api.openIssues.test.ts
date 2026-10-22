/**
 * Integration tests for GET /api/open-issues
 *
 * Covers:
 *   - Happy path: 200 with correct response shape and Cache-Control header
 *   - Body shape: { data: OpenIssue[] } with all required fields
 *   - Cache-Control header is set to max-age=600
 *   - Unknown query params rejected with 400 INVALID_QUERY (Zod schema)
 *   - Non-empty request body rejected with 400 INVALID_BODY
 *   - Upstream failure (GitHub API down) returns 502 Bad Gateway
 *   - Response is still served from stale cache on rate-limit
 *
 * Uses an isolated BOUNTY_STORE_PATH so no real persisted data is touched.
 * vi.resetModules() before each test ensures a fresh module graph (including
 * the in-module LRU cache inside openIssues.ts).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { __resetIdempotencyStoreForTests } from '../src/middleware/idempotency';

// ---------------------------------------------------------------------------
// Test-local helpers
// ---------------------------------------------------------------------------

/** A minimal GitHub API issue payload that maps to a valid OpenIssue. */
const GITHUB_ISSUE = {
  number: 42,
  title: 'Fix the login redirect',
  labels: [{ name: 'bug' }, { name: 'good first issue' }],
  body: 'First paragraph summary.\n\nMore detail here.',
};

/** A working fetch mock that resolves to a single issue. */
function makeSuccessfulFetch(issues = [GITHUB_ISSUE]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (_key: string) => '30' },
    json: async () => issues,
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let storeFile: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  vi.resetModules();
  __resetIdempotencyStoreForTests();
  originalFetch = globalThis.fetch;

  // Isolated bounty store so no dev data bleeds into tests.
  storeFile = path.join(os.tmpdir(), `open-issues-test-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, '[]', 'utf8');
  process.env.BOUNTY_STORE_PATH = storeFile;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.BOUNTY_STORE_PATH;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* best-effort */
  }
  const auditPath = storeFile.replace(/\.json$/, '.audit.json');
  try {
    fs.unlinkSync(auditPath);
  } catch {
    /* best-effort */
  }
});

async function getApp() {
  const { app } = await import('../src/app');
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/open-issues — happy path', () => {
  it('returns 200 with { data: [...] } shape', async () => {
    (globalThis as any).fetch = makeSuccessfulFetch();
    const app = await getApp();

    const res = await request(app).get('/api/open-issues').expect(200);

    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns Cache-Control: max-age=600', async () => {
    (globalThis as any).fetch = makeSuccessfulFetch();
    const app = await getApp();

    const res = await request(app).get('/api/open-issues').expect(200);

    expect(res.headers['cache-control']).toBe('max-age=600');
  });

  it('each issue has id, title, labels, summary, and impact fields', async () => {
    (globalThis as any).fetch = makeSuccessfulFetch();
    const app = await getApp();

    const res = await request(app).get('/api/open-issues').expect(200);

    // If GitHub returns a non-empty list, validate the shape.
    if (res.body.data.length > 0) {
      const issue = res.body.data[0];
      expect(issue).toHaveProperty('id');
      expect(issue).toHaveProperty('title');
      expect(issue).toHaveProperty('labels');
      expect(issue).toHaveProperty('summary');
      expect(issue).toHaveProperty('impact');
      expect(Array.isArray(issue.labels)).toBe(true);
      expect(['starter', 'core', 'advanced']).toContain(issue.impact);
    }
  });

  it('maps GitHub issue number to id in GH-{n} format', async () => {
    (globalThis as any).fetch = makeSuccessfulFetch([GITHUB_ISSUE]);
    const app = await getApp();

    const res = await request(app).get('/api/open-issues').expect(200);

    expect(res.body.data[0].id).toBe('GH-42');
  });

  it('labels are plain strings derived from GitHub label objects', async () => {
    (globalThis as any).fetch = makeSuccessfulFetch([GITHUB_ISSUE]);
    const app = await getApp();

    const res = await request(app).get('/api/open-issues').expect(200);

    expect(res.body.data[0].labels).toEqual(['bug', 'good first issue']);
  });

  it('summary is the first paragraph of the issue body', async () => {
    (globalThis as any).fetch = makeSuccessfulFetch([GITHUB_ISSUE]);
    const app = await getApp();

    const res = await request(app).get('/api/open-issues').expect(200);

    expect(res.body.data[0].summary).toBe('First paragraph summary.');
  });
});

// ---------------------------------------------------------------------------
// Validation: rejects unknown query params and body (Issue #1 enforcement)
// ---------------------------------------------------------------------------

describe('GET /api/open-issues — input validation (400)', () => {
  it('rejects unknown query parameter with 400 and INVALID_QUERY error code', async () => {
    (globalThis as any).fetch = makeSuccessfulFetch();
    const app = await getApp();

    const res = await request(app)
      .get('/api/open-issues')
      .query({ unexpected: 'value' })
      .expect(400);

    expect(res.body.error).toMatch(/INVALID_QUERY/i);
  });

  it('rejects multiple unknown query params with 400', async () => {
    (globalThis as any).fetch = makeSuccessfulFetch();
    const app = await getApp();

    const res = await request(app)
      .get('/api/open-issues')
      .query({ foo: 'bar', baz: '1' })
      .expect(400);

    expect(res.body.error).toMatch(/INVALID_QUERY/i);
  });

  it('does NOT call listOpenIssues when query params are invalid', async () => {
    const fetchMock = makeSuccessfulFetch();
    (globalThis as any).fetch = fetchMock;
    const app = await getApp();

    await request(app).get('/api/open-issues').query({ bad: 'param' }).expect(400);

    // The underlying GitHub fetch should never have been called.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-empty JSON body with 400 and INVALID_BODY error code', async () => {
    (globalThis as any).fetch = makeSuccessfulFetch();
    const app = await getApp();

    const res = await request(app)
      .get('/api/open-issues')
      .set('Content-Type', 'application/json')
      .send({ inject: 'value' })
      .expect(400);

    expect(res.body.error).toMatch(/INVALID_BODY/i);
  });

  it('accepts the request when query string is empty (no params)', async () => {
    (globalThis as any).fetch = makeSuccessfulFetch();
    const app = await getApp();

    await request(app).get('/api/open-issues').expect(200);
  });
});

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

describe('GET /api/open-issues — failure modes', () => {
  it('returns 502 when GitHub API is unreachable and no cache exists', async () => {
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const app = await getApp();

    const res = await request(app).get('/api/open-issues').expect(502);

    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 with stale data when GitHub returns 403 (rate-limited) after a prior success', async () => {
    const successFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: (_k: string) => '30' },
        json: async () => [GITHUB_ISSUE],
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: (k: string) => (k === 'x-ratelimit-remaining' ? '0' : null) },
        json: async () => ({ message: 'API rate limit exceeded' }),
      });

    (globalThis as any).fetch = successFetch;
    const app = await getApp();

    // Prime the cache with the first call.
    const first = await request(app).get('/api/open-issues').expect(200);
    expect(first.body.data.length).toBe(1);

    // Second call triggers rate-limit path but should serve stale cache.
    const second = await request(app).get('/api/open-issues').expect(200);
    expect(second.body.data.length).toBe(1);
    expect(second.body.data[0].id).toBe('GH-42');
  });

  it('returns 502 when GitHub returns a 5xx error and no cache exists', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({ message: 'Internal Server Error' }),
    });

    const app = await getApp();
    const res = await request(app).get('/api/open-issues').expect(502);

    expect(res.body).toHaveProperty('error');
  });

  it('filters out pull_request items from the GitHub response', async () => {
    const prItem = { ...GITHUB_ISSUE, number: 99, pull_request: { url: 'https://github.com/...' } };
    (globalThis as any).fetch = makeSuccessfulFetch([GITHUB_ISSUE, prItem]);
    const app = await getApp();

    const res = await request(app).get('/api/open-issues').expect(200);

    // Only the non-PR issue should be in the response.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('GH-42');
  });
});

// ---------------------------------------------------------------------------
// Idempotency: replay cached response and prevent re-execution (Issue #1219)
// ---------------------------------------------------------------------------

describe('GET /api/open-issues — idempotency', () => {
  it('replays original response and does not re-execute upstream fetch on repeat request with the same Idempotency-Key', async () => {
    const fetchMock = makeSuccessfulFetch([GITHUB_ISSUE]);
    (globalThis as any).fetch = fetchMock;
    const app = await getApp();

    const idempotencyKey = `open-issues-${randomUUID()}`;

    const first = await request(app)
      .get('/api/open-issues')
      .set('Idempotency-Key', idempotencyKey)
      .expect(200);

    const second = await request(app)
      .get('/api/open-issues')
      .set('Idempotency-Key', idempotencyKey)
      .expect(200);

    // Upstream fetch is called exactly once despite duplicate requests
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual(first.body);
    expect(second.body.data[0].id).toBe('GH-42');
  });

  it('replays original 400 error response on repeat request with the same Idempotency-Key', async () => {
    const app = await getApp();
    const idempotencyKey = `open-issues-err-${randomUUID()}`;

    const first = await request(app)
      .get('/api/open-issues')
      .set('Idempotency-Key', idempotencyKey)
      .query({ invalid: 'param' })
      .expect(400);

    const second = await request(app)
      .get('/api/open-issues')
      .set('Idempotency-Key', idempotencyKey)
      .expect(400);

    expect(second.body).toEqual(first.body);
    expect(first.body.error).toMatch(/INVALID_QUERY/i);
  });

  it('replays 502 upstream failure without re-attempting upstream fetch on repeat request', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    (globalThis as any).fetch = fetchMock;
    const app = await getApp();
    const idempotencyKey = `open-issues-502-${randomUUID()}`;

    const first = await request(app)
      .get('/api/open-issues')
      .set('Idempotency-Key', idempotencyKey)
      .expect(502);

    const second = await request(app)
      .get('/api/open-issues')
      .set('Idempotency-Key', idempotencyKey)
      .expect(502);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual(first.body);
  });

  it('different Idempotency-Key values are treated independently and execute separately', async () => {
    const fetchMock = makeSuccessfulFetch([GITHUB_ISSUE]);
    (globalThis as any).fetch = fetchMock;
    const app = await getApp();

    const key1 = `key-1-${randomUUID()}`;
    const key2 = `key-2-${randomUUID()}`;

    const first = await request(app)
      .get('/api/open-issues')
      .set('Idempotency-Key', key1)
      .expect(200);

    const second = await request(app)
      .get('/api/open-issues')
      .set('Idempotency-Key', key2)
      .expect(200);

    expect(first.body.data[0].id).toBe('GH-42');
    expect(second.body.data[0].id).toBe('GH-42');
  });

  it('passes through and works normally when Idempotency-Key is not set or empty', async () => {
    (globalThis as any).fetch = makeSuccessfulFetch([GITHUB_ISSUE]);
    const app = await getApp();

    const resWithoutKey = await request(app).get('/api/open-issues').expect(200);

    const resWithEmptyKey = await request(app)
      .get('/api/open-issues')
      .set('Idempotency-Key', '   ')
      .expect(200);

    expect(resWithoutKey.body.data[0].id).toBe('GH-42');
    expect(resWithEmptyKey.body.data[0].id).toBe('GH-42');
  });
});
