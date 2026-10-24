import { afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import * as bountyStore from '../src/services/bountyStore';

const originalAuthEnforced = process.env.STELLAR_AUTH_ENFORCED;

afterEach(() => {
  vi.restoreAllMocks();

  if (originalAuthEnforced === undefined) {
    delete process.env.STELLAR_AUTH_ENFORCED;
  } else {
    process.env.STELLAR_AUTH_ENFORCED = originalAuthEnforced;
  }
});

describe('POST /api/bounties — integration test', () => {
  it('rejects missing fields with INVALID_INPUT before signature verification', async () => {
    const createBounty = vi.spyOn(bountyStore, 'createBounty');
    process.env.STELLAR_AUTH_ENFORCED = 'true';
    const res = await request(app).post('/api/bounties').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^INVALID_INPUT:/);
    expect(createBounty).not.toHaveBeenCalled();
  });

  it('rejects missing required fields', async () => {
    const res = await request(app).post('/api/bounties').send({
      repo: 'test/repo',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^INVALID_INPUT:/);
  });

  it('rejects wrong types with INVALID_INPUT', async () => {
    const res = await request(app).post('/api/bounties').send({
      repo: 'test/repo',
      issueNumber: ['1'],
      title: 'Valid title',
      summary: 'This summary is long enough to pass validation.',
      maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      tokenSymbol: 'XLM',
      amount: 10,
      deadlineDays: 7,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^INVALID_INPUT:/);
  });

  it('accepts numeric string input for coerced number fields', async () => {
    process.env.STELLAR_AUTH_ENFORCED = 'true';
    const res = await request(app).post('/api/bounties').send({
      repo: 'test/repo',
      issueNumber: '1',
      title: 'Valid title',
      summary: 'This summary is long enough to pass validation.',
      maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      tokenSymbol: 'XLM',
      amount: '10',
      deadlineDays: '7',
    });

    expect(res.status).toBe(401);
  });

  it.each([0, 0.5, 10000.01])('rejects amount boundary value %s', async (amount) => {
    const res = await request(app).post('/api/bounties').send({
      repo: 'test/repo',
      issueNumber: 1,
      title: 'Valid title',
      summary: 'This summary is long enough to pass validation.',
      maintainer: 'GTEST',
      tokenSymbol: 'XLM',
      amount,
      deadlineDays: 7,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^INVALID_INPUT:/);
  });

  it.each([1, 10000])('accepts supported amount boundary value %s', async (amount) => {
    process.env.STELLAR_AUTH_ENFORCED = 'true';
    const res = await request(app).post('/api/bounties').send({
      repo: 'test/repo',
      issueNumber: 1,
      title: 'Valid title',
      summary: 'This summary is long enough to pass validation.',
      maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      tokenSymbol: 'XLM',
      amount,
      deadlineDays: 7,
    });

    expect(res.status).toBe(401);
  });

  it('rejects unsupported query parameters with INVALID_INPUT', async () => {
    const res = await request(app).post('/api/bounties?unexpected=value').send({
      repo: 'test/repo',
      issueNumber: 1,
      title: 'Valid title',
      summary: 'This summary is long enough to pass validation.',
      maintainer: 'GTEST',
      tokenSymbol: 'XLM',
      amount: 10,
      deadlineDays: 7,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^INVALID_INPUT:/);
  });

  it('accepts valid bounty payload structure', async () => {
    process.env.STELLAR_AUTH_ENFORCED = 'true';

    // This test verifies the API accepts the expected payload shape
    // It may fail on auth (no maintainer signature) but should not fail on validation
    const res = await request(app).post('/api/bounties').send({
      repo: 'test/repo',
      issueNumber: 1,
      title: 'Test bounty',
      summary: 'A sufficiently detailed summary for this test bounty.',
      maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      tokenSymbol: 'XLM',
      amount: 100,
      deadlineDays: 7,
      labels: [],
    });
    expect([401, 403]).toContain(res.status);
  });
});
