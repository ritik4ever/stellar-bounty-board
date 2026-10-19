import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('POST /api/bounties/:id/release — integration test', () => {
  it('rejects non-existent bounty with 404', async () => {
    const res = await request(app).post('/api/bounties/NONEXISTENT/release');
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated release attempt', async () => {
    const res = await request(app).post('/api/bounties/BNTY-1/release').send({});
    expect([400, 401, 403, 404]).toContain(res.status);
  });

  it('returns JSON error on invalid request', async () => {
    const res = await request(app).post('/api/bounties/INVALID/release').send({ txHash: '' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).toBeDefined();
  });
});
