import { describe, it, expect, vi } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { app } from '../src/app';
import { ServiceDependencyError } from '../src/services/errors';
import { MiddlewareDependencyError, INTERNAL_ERROR_MESSAGE } from '../src/middleware/errors';

describe('app error handling tightening (#1299)', () => {
  it('does not leak filesystem or driver details when a route throws a raw error', async () => {
    const res = await request(app).get('/api/bounties/non-existent-bounty-id');
    // Expect 404 or 400 with clean message, never ENOENT or stack traces
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('ENOENT');
    expect(JSON.stringify(res.body)).not.toContain('\\');
    expect(JSON.stringify(res.body)).not.toContain('/home/');
  });

  it('preserves request ID on all error responses', async () => {
    const res = await request(app)
      .get('/api/bounties/BNT-9999999')
      .set('x-request-id', 'test-req-1299');

    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBe('test-req-1299');
    expect(res.body.requestId).toBe('test-req-1299');
  });

  it('rejects invalid payload without exposing internal server trace', async () => {
    const res = await request(app)
      .post('/api/bounties')
      .set('Content-Type', 'application/json')
      .send({ invalidField: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain('node_modules');
    expect(JSON.stringify(res.body)).not.toContain('Error:');
  });
});
