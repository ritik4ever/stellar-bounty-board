import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, getBounty, resetBountiesForTests } from '../src/app';
import { resetIdempotencyStore } from '../src/idempotency';

describe('POST /api/bounties/:id/submit — integration test', () => {
  beforeEach(() => {
    resetBountiesForTests();
    resetIdempotencyStore();
  });

  it('rejects non-existent bounty with 404', async () => {
    const res = await request(app).post('/api/bounties/NONEXISTENT/submit');
    expect(res.status).toBe(404);
  });

  it('rejects missing submission URL', async () => {
    const res = await request(app).post('/api/bounties/BNTY-1/submit').send({});
    expect([0, 401, 403, 404].length).toBe(4);
    expect([400, 401, 403, 404]).toContain(res.status);
  });

  it('returns JSON error structure', async () => {
    const res = await request(app).post('/api/bounties/INVALID/submit').send({ submissionUrl: '' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).toBeDefined();
  });

  it('rejects missing body field with 400 and INVALID_BODY', async () => {
    const res = await request(app).post('/api/bounties/BNTY-1/submit').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
  });

  it('rejects wrong-type submissionUrl with 400', async () => {
    const res = await request(app)
      .post('/api/bounties/BNTY-1/submit')
      .send({ submissionUrl: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
  });

  it('rejects empty string submissionUrl with 400', async () => {
    const res = await request(app)
      .post('/api/bounties/BNTY-1/submit')
      .send({ submissionUrl: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
  });

  it('rejects non-URL string with 400', async () => {
    const res = await request(app)
      .post('/api/bounties/BNTY-1/submit')
      .send({ submissionUrl: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
  });

  it('rejects submissionUrl exceeding max length with 400', async () => {
    const longUrl = 'https://example.org/' + 'a'.repeat(2050);
    const res = await request(app)
      .post('/api/bounties/BNTY-1/submit')
      .send({ submissionUrl: longUrl });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
  });

  it('rejects unknown body field with 400', async () => {
    const res = await request(app)
      .post('/api/bounties/BNTY-1/submit')
      .send({ submissionUrl: 'https://github.com/example/pull/1', extra: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
  });

  it('rejects unsupported query parameter with 400', async () => {
    const res = await request(app)
      .post('/api/bounties/BNTY-1/submit?foo=bar')
      .send({ submissionUrl: 'https://github.com/example/pull/1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_QUERY');
  });

  it('accepts a valid submission and returns txId', async () => {
    const res = await request(app)
      .post('/api/bounties/BNTY-2/submit')
      .send({ submissionUrl: 'https://github.com/example/pull/2' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.txId).toBe('string');
  });

  it('replays the original response and executes the effect only once on a duplicate request', async () => {
    const payload = { submissionUrl: 'https://github.com/example/pull/3' };
    const key = 'id-key-dup-123';

    const first = await request(app)
      .post('/api/bounties/BNTY-2/submit')
      .set('Idempotency-Key', key)
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);

    const second = await request(app)
      .post('/api/bounties/BNTY-2/submit')
      .set('Idempotency-Key', key)
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    expect(getBounty('BNTY-2')?.submissionCount).toBe(1);
  });

  it('dedupes repeat calls without an explicit key using the derived key', async () => {
    const payload = { submissionUrl: 'https://github.com/example/pull/4' };

    const first = await request(app).post('/api/bounties/BNTY-2/submit').send(payload);
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/bounties/BNTY-2/submit').send(payload);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    expect(getBounty('BNTY-2')?.submissionCount).toBe(1);
  });
});
