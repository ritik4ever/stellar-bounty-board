import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

describe('GET /api/health rate limiting (#1180)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('allows requests within the configured health rate limit ceiling', async () => {
    process.env.RATE_LIMIT_TEST_MODE = 'true';
    process.env.RATE_LIMIT_HEALTH_MAX = '5';
    process.env.RATE_LIMIT_HEALTH_WINDOW_MS = '60000';

    const { app } = await import('../src/app');

    const res = await request(app).get('/api/health');

    // Should reach the route and not be blocked with 429
    expect(res.status).toBe(200);
  });

  it('enforces explicit ceiling and returns 429 with Retry-After header when exceeded', async () => {
    process.env.RATE_LIMIT_TEST_MODE = 'true';
    process.env.RATE_LIMIT_HEALTH_MAX = '2';
    process.env.RATE_LIMIT_HEALTH_WINDOW_MS = '60000';

    const { app } = await import('../src/app');

    // First request
    const res1 = await request(app).get('/api/health');
    expect(res1.status).toBe(200);

    // Second request
    const res2 = await request(app).get('/api/health');
    expect(res2.status).toBe(200);

    // Third request - exceeds ceiling of 2
    const res3 = await request(app).get('/api/health');

    expect(res3.status).toBe(429);
    expect(res3.headers['retry-after']).toBeDefined();
    expect(Number(res3.headers['retry-after'])).toBe(60);
    expect(res3.body).toMatchObject({
      error: expect.stringMatching(/too many health check requests/i),
      retryAfter: 60,
    });
  });

  it('does not apply rate limits when in regular test environment without test mode', async () => {
    delete process.env.RATE_LIMIT_TEST_MODE;
    process.env.NODE_ENV = 'test';
    process.env.RATE_LIMIT_HEALTH_MAX = '1';

    const { app } = await import('../src/app');

    // Make multiple requests, none should be 429
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    }
  });
});
