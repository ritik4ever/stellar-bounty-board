import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { app } from '../src/app';
import {
  bountyRecordSchema,
  createBountySchema,
  deepHealthResponseSchema,
  healthResponseSchema,
  submitBountySchema,
  reserveBountySchema,
  maintainerActionSchema,
  openIssueSchema,
  bountyAuditLogListResponseSchema,
} from '../src/validation/schemas';
import { z } from 'zod';

describe('OpenAPI contract — responses match zod schemas', () => {
  it('GET /api/health matches health schema', async () => {
    const res = await request(app).get('/api/health').expect(200);
    healthResponseSchema.strict().parse(res.body);
  });

  it('GET /api/health/deep matches deep health schema', async () => {
    const res = await request(app).get('/api/health/deep').expect(200);
    deepHealthResponseSchema.strict().parse(res.body);
  });

  it('GET /api/openapi.json returns valid OpenAPI specification matching frontend accessibility requirements', async () => {
    const res = await request(app).get('/api/openapi.json').expect(200);
    expect(res.body).toHaveProperty('openapi');
    expect(res.body).toHaveProperty('info');
    expect(res.body).toHaveProperty('paths');
    expect(res.body).toHaveProperty('components');
    expect(res.body.components).toHaveProperty('schemas');

    // Verify key schemas are exposed correctly for client consumption (api.ts / frontend accessibility)
    const schemas = res.body.components.schemas;
    expect(schemas).toHaveProperty('BountyRecord');
    expect(schemas).toHaveProperty('CreateBountyRequest');
    expect(schemas).toHaveProperty('ReserveBountyRequest');
    expect(schemas).toHaveProperty('SubmitBountyRequest');
    expect(schemas).toHaveProperty('MaintainerActionRequest');
    expect(schemas).toHaveProperty('ErrorResponse');
    expect(schemas).toHaveProperty('OpenIssue');
    expect(schemas).toHaveProperty('HealthResponse');
  });

  it('Create, reserve, submit, release flow responses conform', async () => {
    // Create
    const createBody = {
      repo: 'owner/repo',
      issueNumber: 123,
      title: 'Contract test bounty',
      summary: 'A sufficiently long summary for the contract test.',
      maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      tokenSymbol: 'XLM',
      amount: 10,
      deadlineDays: 7,
      labels: ['help wanted'],
    };

    createBountySchema.parse(createBody);
    const createRes = await request(app).post('/api/bounties').send(createBody).expect(201);
    const bounty = bountyRecordSchema.strict().parse(createRes.body.data);

    // Reserve
    const reserveBody = { contributor: 'GBE6AZEUPV75O3Z7OFW4RIMU7DF453AVK5HCXB3PV2I7BBTYEPCOYWSF' };
    reserveBountySchema.parse(reserveBody);
    const reserveRes = await request(app).post(`/api/bounties/${bounty.id}/reserve`).send(reserveBody).expect(200);
    bountyRecordSchema.strict().parse(reserveRes.body.data);

    // Submit
    const submitBody = { contributor: reserveBody.contributor, submissionUrl: 'https://github.com/owner/repo/pull/1' };
    submitBountySchema.parse(submitBody);
    const submitRes = await request(app).post(`/api/bounties/${bounty.id}/submit`).send(submitBody).expect(200);
    bountyRecordSchema.strict().parse(submitRes.body.data);

    // Release
    const releaseBody = { maintainer: createBody.maintainer };
    maintainerActionSchema.parse(releaseBody);
    const releaseRes = await request(app).post(`/api/bounties/${bounty.id}/release`).send(releaseBody).expect(200);
    bountyRecordSchema.strict().parse(releaseRes.body.data);
  });
});