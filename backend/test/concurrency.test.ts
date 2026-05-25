import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONTRIBUTOR, OTHER_ACCOUNT, validCreateBody } from './fixtures';

let storeFile: string;

beforeEach(async () => {
  storeFile = path.join(os.tmpdir(), `bounty-concurrency-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, '[]', 'utf8');
  process.env.BOUNTY_STORE_PATH = storeFile;
  // Clear require cache to ensure fresh state for each test
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    /* best-effort */
  }
  try {
    const auditStorePath = storeFile.replace(/\.json$/i, '.audit.json');
    fs.unlinkSync(auditStorePath);
  } catch {
    /* best-effort */
  }
});

async function getApp() {
  const { app } = await import('../src/app');
  return app;
}

describe('Bounty Reservation Concurrency', () => {
  it('should only allow one successful reservation when two requests are simultaneous', async () => {
    const app = await getApp();

    // 1. Create a bounty
    const createRes = await request(app).post('/api/bounties').send(validCreateBody).expect(201);

    const id = createRes.body.data.id;

    // 2. Fire two simultaneous reserve requests
    // We use Promise.all to fire them as close together as possible
    const [res1, res2] = await Promise.all([
      request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: CONTRIBUTOR }),
      request(app).post(`/api/bounties/${id}/reserve`).send({ contributor: OTHER_ACCOUNT }),
    ]);

    // 3. Assert exactly one success
    const statuses = [res1.status, res2.status];
    const successes = statuses.filter((s) => s === 200).length;
    const failures = statuses.filter((s) => s === 409 || s === 400).length;

    expect(
      successes,
      `Expected exactly one 200 response, but got ${successes}. Statuses: ${statuses}`,
    ).toBe(1);
    expect(
      failures,
      `Expected exactly one error response (400 or 409), but got ${failures}. Statuses: ${statuses}`,
    ).toBe(1);

    // 4. Verify the state in the store
    const getRes = await request(app).get(`/api/bounties/${id}`).expect(200);
    expect(getRes.body.data.status).toBe('reserved');
    // Only one contributor should be recorded
    const contributor = getRes.body.data.contributor;
    expect([CONTRIBUTOR, OTHER_ACCOUNT]).toContain(contributor);
  });
});
