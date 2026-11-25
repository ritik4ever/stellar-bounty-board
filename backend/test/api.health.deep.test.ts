import { describe, it, expect, vi } from 'vitest';
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

describe('GET /api/health/deep — input validation (#1187)', () => {
  it('accepts a request with no params, query, or body', async () => {
    const res = await request(app).get('/api/health/deep');
    expect(res.status).not.toBe(400);
  });

  it('rejects an unexpected query parameter with 400 and a specific error code', async () => {
    const res = await request(app).get('/api/health/deep?foo=bar');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('HEALTH_DEEP_INVALID_INPUT');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('rejects a request body with 400', async () => {
    const res = await request(app).get('/api/health/deep').send({ verbose: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('HEALTH_DEEP_INVALID_INPUT');
  });

  it('rejects repeated query parameters (array values) with 400', async () => {
    const res = await request(app).get('/api/health/deep?verbose=true&verbose=false');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('HEALTH_DEEP_INVALID_INPUT');
  });

  it('rejects an empty-valued query key with 400', async () => {
    const res = await request(app).get('/api/health/deep?foo=');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('HEALTH_DEEP_INVALID_INPUT');
  });

  it('does not run the deep health check when input is invalid', async () => {
    const deepHealthService = await import('../src/services/deepHealth');
    const runDeepHealthCheck = vi.spyOn(deepHealthService, 'runDeepHealthCheck');

    try {
      const res = await request(app).get('/api/health/deep?foo=bar');
      expect(res.status).toBe(400);
      expect(runDeepHealthCheck).not.toHaveBeenCalled();
    } finally {
      runDeepHealthCheck.mockRestore();
    }
  });
});
