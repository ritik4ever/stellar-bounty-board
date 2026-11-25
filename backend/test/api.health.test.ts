import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
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

  it('replays the original response without rerunning the health check for the same key', async () => {
    const toISOString = vi.spyOn(Date.prototype, 'toISOString');
    const idempotencyKey = `health-${randomUUID()}`;

    try {
      const first = await request(app)
        .get('/api/health')
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);
      const second = await request(app)
        .get('/api/health')
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);

      expect(toISOString).toHaveBeenCalledTimes(1);
      expect(second.body).toEqual(first.body);
    } finally {
      toISOString.mockRestore();
    }
  });
});
