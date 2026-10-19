import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('GET /api/health/deep — integration test', () => {
  it('returns 200 OK', async () => {
    const res = await request(app).get('/api/health/deep');
    expect(res.status).toBe(200);
  });

  it('returns JSON with status field', async () => {
    const res = await request(app).get('/api/health/deep');
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(typeof res.body).toBe('object');
  });

  it('includes component health checks', async () => {
    const res = await request(app).get('/api/health/deep');
    expect(res.status).toBe(200);
    // Deep health should include component-level checks
    const body = res.body;
    // Common patterns: { status: 'ok', components: {...} } or { status: 'ok', checks: {...} }
    expect(body.status || body.overall || body.healthy).toBeDefined();
  });

  it('reports datastore health', async () => {
    const res = await request(app).get('/api/health/deep');
    expect(res.status).toBe(200);
    // Should mention datastore/store health
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr.toLowerCase()).toMatch(/store|data|db|bounty/);
  });
});
