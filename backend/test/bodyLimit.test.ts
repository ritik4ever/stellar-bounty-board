/**
 * bodyLimit.test.ts
 *
 * Verifies per-route request-body size limits:
 *   - Default routes reject payloads over 16 kb with 413
 *   - PATCH /api/bounties/:id/notes accepts payloads up to 100 kb
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAINTAINER, validCreateBody } from './fixtures';

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `bounty-body-limit-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, '[]', 'utf8');
  process.env.BOUNTY_STORE_PATH = storeFile;
  process.env.NODE_ENV = 'test';
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  try { fs.unlinkSync(storeFile); } catch { /* best-effort */ }
  try { fs.unlinkSync(storeFile.replace(/\.json$/i, '.audit.json')); } catch { /* best-effort */ }
});

async function getApp() {
  const { app } = await import('../src/app');
  return app;
}

/** Creates a bounty and returns its id */
async function seedBounty(app: Express.Application): Promise<string> {
  const res = await request(app)
    .post('/api/bounties')
    .set('Content-Type', 'application/json')
    .send(validCreateBody)
    .expect(201);
  return res.body.data.id;
}

function kb(n: number): string {
  return 'x'.repeat(n * 1024);
}

describe('body size limits — default (16 kb)', () => {
  it('rejects a POST /api/bounties body over 16 kb with 413', async () => {
    const app = await getApp();
    const oversized = {
      ...validCreateBody,
      summary: kb(17), // pushes it well over 16 kb
    };
    const res = await request(app)
      .post('/api/bounties')
      .set('Content-Type', 'application/json')
      .send(oversized);

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/payload too large/i);
  });

  it('accepts a POST /api/bounties body under 16 kb', async () => {
    const app = await getApp();
    const res = await request(app)
      .post('/api/bounties')
      .set('Content-Type', 'application/json')
      .send(validCreateBody);

    expect(res.status).toBe(201);
  });
});

describe('body size limits — notes route (100 kb override)', () => {
  it('accepts a PATCH /api/bounties/:id/notes body under 100 kb', async () => {
    const app = await getApp();
    const id = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}/notes`)
      .set('Content-Type', 'application/json')
      .send({ maintainer: MAINTAINER, notes: kb(50) });

    // 400 means the body was parsed fine (notes too long per schema) — not a size rejection
    expect(res.status).not.toBe(413);
  });

  it('rejects a PATCH /api/bounties/:id/notes body over 100 kb with 413', async () => {
    const app = await getApp();
    const id = await seedBounty(app);

    const res = await request(app)
      .patch(`/api/bounties/${id}/notes`)
      .set('Content-Type', 'application/json')
      .send({ maintainer: MAINTAINER, notes: kb(101) });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/payload too large/i);
  });
});
