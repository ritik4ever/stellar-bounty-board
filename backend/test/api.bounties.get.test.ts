import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app';
import * as bountyStore from '../src/services/bountyStore';

describe('GET /api/bounties — integration test', () => {
  it('returns 200 OK', async () => {
    const res = await request(app).get('/api/bounties');
    expect(res.status).toBe(200);
  });

  it('replays the original response without repeating the list operation for the same key', async () => {
    const listSpy = vi.spyOn(bountyStore, 'listBountiesCached');
    const idempotencyKey = `bounties-${randomUUID()}`;

    try {
      const first = await request(app)
        .get('/api/bounties')
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);
      const second = await request(app)
        .get('/api/bounties')
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);

      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(second.body).toEqual(first.body);
    } finally {
      listSpy.mockRestore();
    }
  });

  it('returns a paginated data array', async () => {
    const res = await request(app).get('/api/bounties');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
  });

  it('supports pagination with page + limit params', async () => {
    const res = await request(app).get('/api/bounties?page=1&limit=5');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
  });

  it('returns total count in response header or body', async () => {
    const res = await request(app).get('/api/bounties?page=1&limit=5');
    expect(res.status).toBe(200);
    // The API may return total in a header or a wrapper object
    // Check both patterns
    const hasTotal =
      res.headers['x-total-count'] ||
      (res.body && typeof res.body === 'object' && res.body.total !== undefined) ||
      Array.isArray(res.body);
    expect(hasTotal).toBeTruthy();
  });

  it('rejects an invalid page parameter with 400', async () => {
    const res = await request(app).get('/api/bounties?page=abc');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BOUNTIES_INVALID_INPUT');
  });

  it('rejects a negative limit with 400', async () => {
    const res = await request(app).get('/api/bounties?limit=-1');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BOUNTIES_INVALID_INPUT');
  });
});

// Documented: 2026-10-01 — per issue #1192

describe('GET /api/bounties — input validation', () => {
  const invalid = (query: string) => request(app).get(`/api/bounties?${query}`);

  it('accepts an empty query string', async () => {
    const res = await request(app).get('/api/bounties').expect(200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
  });

  it('rejects wrong-type values with 400 and the BOUNTIES_INVALID_INPUT code', async () => {
    for (const query of [
      'page=abc',
      'limit=1.5',
      'pageSize=abc',
      'minReward=abc',
      'maxReward=Infinity',
      'deadlineBefore=not-a-date',
      'deadlineAfter=not-a-date',
      'status=bogus',
      'sort=name',
      'order=up',
      'contributor=not-a-stellar-key',
      'maintainer=not-a-stellar-key',
    ]) {
      const res = await invalid(query);
      expect(res.status, query).toBe(400);
      expect(res.body.code, query).toBe('BOUNTIES_INVALID_INPUT');
      expect(Array.isArray(res.body.details), query).toBe(true);
    }
  });

  it('rejects repeated query parameters that arrive as arrays', async () => {
    const res = await invalid('page=1&page=2');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BOUNTIES_INVALID_INPUT');
  });

  it('rejects unknown query parameters', async () => {
    const res = await invalid('unexpected=value');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BOUNTIES_INVALID_INPUT');
  });

  it('rejects a non-empty request body', async () => {
    const res = await request(app).get('/api/bounties').send({ extra: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BOUNTIES_INVALID_INPUT');
  });

  it('rejects values outside the pagination boundaries', async () => {
    for (const query of [
      'page=0',
      'page=-1',
      'limit=0',
      'limit=101',
      'pageSize=0',
      'pageSize=101',
    ]) {
      const res = await invalid(query);
      expect(res.status, query).toBe(400);
      expect(res.body.code, query).toBe('BOUNTIES_INVALID_INPUT');
    }
  });

  it('accepts values on the pagination boundaries', async () => {
    for (const query of ['page=1&limit=1', 'page=1&limit=100', 'pageSize=1', 'pageSize=100']) {
      const res = await invalid(query);
      expect(res.status, query).toBe(200);
    }
  });

  it('rejects negative rewards and a minReward above maxReward', async () => {
    for (const query of ['minReward=-1', 'maxReward=-0.01', 'minReward=10&maxReward=5']) {
      const res = await invalid(query);
      expect(res.status, query).toBe(400);
      expect(res.body.code, query).toBe('BOUNTIES_INVALID_INPUT');
    }
  });

  it('accepts a zero minimum reward and equal reward bounds', async () => {
    for (const query of ['minReward=0', 'minReward=10&maxReward=10']) {
      const res = await invalid(query);
      expect(res.status, query).toBe(200);
    }
  });

  it('accepts all documented filters with valid values', async () => {
    const res = await invalid(
      'q=fix&repo=owner%2Frepo&status=open&tokenSymbol=xlm&sort=amount&order=asc&page=1&limit=10' +
        '&minReward=0&maxReward=100&deadlineBefore=2027-01-01T00%3A00%3A00.000Z' +
        '&deadlineAfter=2026-01-01T00%3A00%3A00.000Z'
    );
    expect(res.status).toBe(200);
  });

  it('validates before calling the store', async () => {
    const listSpy = vi.spyOn(bountyStore, 'listBountiesCached');

    try {
      const invalidQuery = await invalid('page=abc').expect(400);
      expect(invalidQuery.body.code).toBe('BOUNTIES_INVALID_INPUT');

      const invalidBody = await request(app).get('/api/bounties').send({ extra: true });
      expect(invalidBody.status).toBe(400);

      expect(listSpy).not.toHaveBeenCalled();
    } finally {
      listSpy.mockRestore();
    }
  });
});
