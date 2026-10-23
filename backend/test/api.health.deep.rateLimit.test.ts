import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

describe('GET /api/health/deep rate limiting (#1184)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('enforces its configured ceiling and returns 429 with Retry-After', async () => {
    process.env.RATE_LIMIT_TEST_MODE = 'true';
    process.env.RATE_LIMIT_DEEP_HEALTH_MAX = '2';
    process.env.RATE_LIMIT_DEEP_HEALTH_WINDOW_MS = '60000';

    const { app } = await import('../src/app');

    expect((await request(app).get('/api/health/deep?unexpected=1')).status).toBe(400);
    expect((await request(app).get('/api/health/deep?unexpected=1')).status).toBe(400);

    const response = await request(app).get('/api/health/deep?unexpected=1');

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('60');
    expect(response.body).toMatchObject({
      error: expect.stringMatching(/too many deep health check requests/i),
      retryAfter: 60,
    });
  });
});
