import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('GET /api/health — integration test', () => {
  it('returns 200 OK', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
  it('returns JSON with status field', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBeDefined();
  });
  it('returns ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.status).toBe('ok');
  });
});
