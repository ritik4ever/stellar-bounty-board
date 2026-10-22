import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./services/bountyStore', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, refundBounty: vi.fn(async (id: string) => ({ id, status: 'refunded' })) };
});

import { app } from './app';
import { refundBounty } from './services/bountyStore';
import { resetIdempotencyStore } from './idempotency';

const id = '11111111-1111-4111-8111-111111111111';
const body = { maintainer: 'G' + 'A'.repeat(55) };

describe('POST /api/bounties/:id/refund idempotency', () => {
  beforeEach(() => {
    resetIdempotencyStore();
    vi.clearAllMocks();
  });

  it('executes the refund exactly once for a duplicated request', async () => {
    const a = await request(app).post(`/api/bounties/${id}/refund`).set('Idempotency-Key', 'k1').send(body);
    const b = await request(app).post(`/api/bounties/${id}/refund`).set('Idempotency-Key', 'k1').send(body);

    expect(a.status).toBe(200);
    expect(refundBounty).toHaveBeenCalledTimes(1);
    expect(b.status).toBe(a.status);
    expect(b.body).toEqual(a.body);
    expect(b.headers['idempotent-replayed']).toBe('true');
  });

  it('dedupes concurrent duplicates', async () => {
    const [a, b] = await Promise.all([
      request(app).post(`/api/bounties/${id}/refund`).set('Idempotency-Key', 'k2').send(body),
      request(app).post(`/api/bounties/${id}/refund`).set('Idempotency-Key', 'k2').send(body),
    ]);
    expect(refundBounty).toHaveBeenCalledTimes(1);
    expect(a.body).toEqual(b.body);
  });
});
