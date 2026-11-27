import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

describe('POST /api/bounties/:id/reserve rate limiting (#1201)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('allows requests within the configured reserve rate limit ceiling', async () => {
    process.env.RATE_LIMIT_TEST_MODE = 'true';
    process.env.RATE_LIMIT_RESERVE_MAX = '5';
    process.env.RATE_LIMIT_RESERVE_WINDOW_MS = '60000';

    const { app } = await import('../src/app');

    const res = await request(app)
      .post('/api/bounties/BNTY-9999/reserve')
      .set('Content-Type', 'application/json')
      .send({
        contributor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      });

    // Should reach the route and not be blocked with 429
    expect(res.status).not.toBe(429);
  });

  it('enforces explicit ceiling and returns 429 with Retry-After header when exceeded', async () => {
    process.env.RATE_LIMIT_TEST_MODE = 'true';
    process.env.RATE_LIMIT_RESERVE_MAX = '2';
    process.env.RATE_LIMIT_RESERVE_WINDOW_MS = '60000';

    const { app } = await import('../src/app');

    const body = {
      contributor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    };

    // First request
    const res1 = await request(app)
      .post('/api/bounties/BNTY-9999/reserve')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res1.status).not.toBe(429);

    // Second request
    const res2 = await request(app)
      .post('/api/bounties/BNTY-9999/reserve')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res2.status).not.toBe(429);

    // Third request - exceeds ceiling of 2
    const res3 = await request(app)
      .post('/api/bounties/BNTY-9999/reserve')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res3.status).toBe(429);
    expect(res3.headers['retry-after']).toBeDefined();
    expect(Number(res3.headers['retry-after'])).toBeGreaterThan(0);
    expect(res3.body).toMatchObject({
      error: expect.stringMatching(/too many bounty reservation attempts/i),
      retryAfter: expect.any(Number),
    });
  });

  it('does not apply rate limits when in regular test environment without test mode', async () => {
    delete process.env.RATE_LIMIT_TEST_MODE;
    process.env.NODE_ENV = 'test';
    process.env.RATE_LIMIT_RESERVE_MAX = '1';

    const { app } = await import('../src/app');

    const body = {
      contributor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    };

    // Make multiple requests, none should be 429
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/bounties/BNTY-9999/reserve')
        .set('Content-Type', 'application/json')
        .send(body);
      expect(res.status).not.toBe(429);
    }
  });
});
