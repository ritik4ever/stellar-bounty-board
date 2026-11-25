import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import * as bountyStore from '../src/services/bountyStore';
import { reserveBountyRequestSchema } from '../src/validation/schemas';

describe('POST /api/bounties/:id/reserve — integration test', () => {
  it('rejects non-existent bounty with 404', async () => {
    const res = await request(app)
      .post('/api/bounties/NONEXISTENT/reserve')
      .send({ contributor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' });
    expect(res.status).toBe(404);
  });

  it('accepts the minimum valid expectedVersion boundary', () => {
    const result = reserveBountyRequestSchema.safeParse({
      params: { id: 'BNTY-1' },
      query: {},
      body: {
        contributor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        expectedVersion: 1,
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects missing, wrong-type, and boundary inputs before calling the store', async () => {
    const reserveSpy = vi.spyOn(bountyStore, 'reserveBounty');

    const invalidRequests = [
      {
        label: 'missing contributor',
        path: '/api/bounties/BNTY-1/reserve',
        body: {},
      },
      {
        label: 'wrong-type contributor and expectedVersion',
        path: '/api/bounties/BNTY-1/reserve',
        body: { contributor: 123, expectedVersion: '1' },
      },
      {
        label: 'expectedVersion below its minimum boundary',
        path: '/api/bounties/BNTY-1/reserve',
        body: {
          contributor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          expectedVersion: 0,
        },
      },
      {
        label: 'empty bounty ID',
        path: '/api/bounties/%20/reserve',
        body: { contributor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' },
      },
      {
        label: 'unsupported query parameter',
        path: '/api/bounties/BNTY-1/reserve?unexpected=value',
        body: { contributor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' },
      },
      {
        label: 'unsupported body field',
        path: '/api/bounties/BNTY-1/reserve',
        body: {
          contributor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          extra: true,
        },
      },
    ];

    try {
      for (const invalid of invalidRequests) {
        const res = await request(app).post(invalid.path).send(invalid.body);
        expect(res.status, invalid.label).toBe(400);
        expect(res.body.code, invalid.label).toBe('BOUNTY_RESERVE_INVALID_INPUT');
        expect(Array.isArray(res.body.details), invalid.label).toBe(true);
      }

      expect(reserveSpy).not.toHaveBeenCalled();
    } finally {
      reserveSpy.mockRestore();
    }
  });
});
