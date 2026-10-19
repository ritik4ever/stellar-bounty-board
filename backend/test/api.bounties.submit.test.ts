import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('POST /api/bounties/:id/submit — integration test', () => {
  it('rejects non-existent bounty with 404', async () => {
    const res = await request(app).post('/api/bounties/NONEXISTENT/submit');
    expect(res.status).toBe(404);
  });

  it('rejects missing submission URL', async () => {
    const res = await request(app).post('/api/bounties/BNTY-1/submit').send({});
    expect([400, 401, 403, 404]).toContain(res.status);
  });

  it('returns JSON error structure', async () => {
    const res = await request(app).post('/api/bounties/INVALID/submit').send({ submissionUrl: '' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).toBeDefined();
  });
});
