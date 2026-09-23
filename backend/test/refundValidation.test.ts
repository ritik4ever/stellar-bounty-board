import { describe, expect, it } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validateBody } from '../src/middleware/validateBody';
import { maintainerActionSchema, refundBountySchema } from '../src/validation/schemas';

const validMaintainer = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGOBKGOTQTV4HXY5CAX';
const validTxHash = 'a'.repeat(64);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/bounties/:id/refund', validateBody(refundBountySchema), (req: Request, res: Response) => {
    res.status(200).json({ status: 'refunded', data: req.body });
  });
  return app;
}

describe('POST /api/bounties/:id/refund input validation (#1216)', () => {
  const app = buildApp();

  it('passes validation when maintainer and transactionHash are valid', async () => {
    const res = await request(app)
      .post('/api/bounties/BNT-0001/refund')
      .send({
        maintainer: validMaintainer,
        transactionHash: validTxHash,
      })
      .expect(200);

    expect(res.body.status).toBe('refunded');
    expect(res.body.data.maintainer).toBe(validMaintainer);
    expect(res.body.data.transactionHash).toBe(validTxHash);
  });

  it('passes validation when optional transactionHash is omitted', async () => {
    const res = await request(app)
      .post('/api/bounties/BNT-0001/refund')
      .send({
        maintainer: validMaintainer,
      })
      .expect(200);

    expect(res.body.status).toBe('refunded');
    expect(res.body.data.maintainer).toBe(validMaintainer);
  });

  it('rejects with 400 when maintainer address is missing', async () => {
    const res = await request(app)
      .post('/api/bounties/BNT-0001/refund')
      .send({
        transactionHash: validTxHash,
      })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
    expect(Array.isArray(res.body.details)).toBe(true);
    const paths = res.body.details.map((d: { path: string[] }) => d.path.join('.'));
    expect(paths).toContain('maintainer');
  });

  it('rejects with 400 when maintainer address format/checksum is invalid', async () => {
    const res = await request(app)
      .post('/api/bounties/BNT-0001/refund')
      .send({
        maintainer: 'INVALID_STELLAR_ADDRESS',
      })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details[0].message).toContain('Must be a valid Stellar public key');
  });

  it('rejects with 400 when transactionHash is not a 64-char hex string', async () => {
    const res = await request(app)
      .post('/api/bounties/BNT-0001/refund')
      .send({
        maintainer: validMaintainer,
        transactionHash: 'invalid-hash-123',
      })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details[0].message).toContain('Transaction hash must be a 64 character hex string');
  });

  it('strips unknown extra parameters safely from request body', async () => {
    const res = await request(app)
      .post('/api/bounties/BNT-0001/refund')
      .send({
        maintainer: validMaintainer,
        maliciousField: 'exploit_payload',
      })
      .expect(200);

    expect(res.body.data).not.toHaveProperty('maliciousField');
  });
});
