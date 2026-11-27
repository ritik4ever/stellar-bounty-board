import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('POST /api/bounties — integration test', () => {
  it('rejects empty body with 400', async () => {
    const res = await request(app).post('/api/bounties').send({});
    expect(res.status).toBe(400);
  });

  it('rejects missing required fields', async () => {
    const res = await request(app).post('/api/bounties').send({
      repo: 'test/repo',
      // Missing: issueNumber, title, maintainer, tokenSymbol, amount, deadlineDays
    });
    expect(res.status).toBe(400);
  });

  it('accepts valid bounty payload structure', async () => {
    // This test verifies the API accepts the expected payload shape
    // It may fail on auth (no maintainer signature) but should not fail on validation
    const res = await request(app).post('/api/bounties').send({
      repo: 'test/repo',
      issueNumber: 1,
      title: 'Test bounty',
      summary: 'Test summary',
      maintainer: 'GTEST',
      tokenSymbol: 'XLM',
      amount: 100,
      deadlineDays: 7,
      labels: [],
    });
    // Expect either 201 (created) or 401/403 (auth required) — not 400 (validation error)
    expect([201, 401, 403]).toContain(res.status);
  });
});
