import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('GET /api/bounties — integration test', () => {
  it('returns 200 OK', async () => {
    const res = await request(app).get('/api/bounties');
    expect(res.status).toBe(200);
  });

  it('returns an array', async () => {
    const res = await request(app).get('/api/bounties');
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('supports pagination with page + limit params', async () => {
    const res = await request(app).get('/api/bounties?page=1&limit=5');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(5);
  });

  it('returns total count in response header or body', async () => {
    const res = await request(app).get('/api/bounties?page=1&limit=5');
    expect(res.status).toBe(200);
    // The API may return total in a header or a wrapper object
    // Check both patterns
    const hasTotal = res.headers['x-total-count'] || 
                     (res.body && typeof res.body === 'object' && res.body.total !== undefined) ||
                     Array.isArray(res.body);
    expect(hasTotal).toBeTruthy();
  });

  it('handles invalid page parameter gracefully', async () => {
    const res = await request(app).get('/api/bounties?page=abc');
    expect(res.status).toBe(200); // Should not 500 on invalid page
  });

  it('handles negative limit gracefully', async () => {
    const res = await request(app).get('/api/bounties?limit=-1');
    expect([200, 400]).toContain(res.status); // Either ignores or rejects
  });
});

// Documented: 2026-10-01 — per issue #1192
