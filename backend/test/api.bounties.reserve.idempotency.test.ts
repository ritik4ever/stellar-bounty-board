import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/bountyStore', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, reserveBounty: vi.fn(async (id: string) => ({ id, status: 'reserved' })) };
});

import { app } from '../src/app';
import { reserveBounty } from '../src/services/bountyStore';
import { resetIdempotencyStore } from '../src/idempotency';

const id = 'BNT-0001';
const body = { contributor: Keypair.random().publicKey() };

describe('POST /api/bounties/:id/reserve idempotency', () => {
  beforeEach(() => {
    resetIdempotencyStore();
    vi.clearAllMocks();
  });

  it('executes the reservation exactly once for a duplicated request', async () => {
    const a = await request(app)
      .post(`/api/bounties/${id}/reserve`)
      .set('Idempotency-Key', 'r1')
      .send(body);
    const b = await request(app)
      .post(`/api/bounties/${id}/reserve`)
      .set('Idempotency-Key', 'r1')
      .send(body);

    expect(a.status).toBe(200);
    expect(reserveBounty).toHaveBeenCalledTimes(1);
    expect(b.status).toBe(a.status);
    expect(b.body).toEqual(a.body);
    expect(b.headers['idempotent-replayed']).toBe('true');
  });

  it('dedupes concurrent duplicates', async () => {
    const [a, b] = await Promise.all([
      request(app).post(`/api/bounties/${id}/reserve`).set('Idempotency-Key', 'r2').send(body),
      request(app).post(`/api/bounties/${id}/reserve`).set('Idempotency-Key', 'r2').send(body),
    ]);
    expect(reserveBounty).toHaveBeenCalledTimes(1);
    expect(a.body).toEqual(b.body);
  });

  it('rejects key reuse with a different payload', async () => {
    await request(app).post(`/api/bounties/${id}/reserve`).set('Idempotency-Key', 'r3').send(body);
    const other = await request(app)
      .post(`/api/bounties/${id}/reserve`)
      .set('Idempotency-Key', 'r3')
      .send({ contributor: Keypair.random().publicKey() });
    expect(other.status).toBe(422);
    expect(reserveBounty).toHaveBeenCalledTimes(1);
  });
});
