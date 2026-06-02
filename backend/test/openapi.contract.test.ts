import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { app } from '../src/app';
import {
  bountyRecordSchema,
  createBountySchema,
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
    const reserveBody = { contributor: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKCEL9LGAQLHFLQ2GN7SY' };
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

    // Audit logs
    const auditRes = await request(app).get(`/api/bounties/${bounty.id}/audit-logs`).expect(200);
    bountyAuditLogListResponseSchema.strict().parse(auditRes.body);
  });

  it('GET /api/open-issues responds with OpenIssue array', async () => {
    const res = await request(app).get('/api/open-issues').expect(200);
    const data = z.array(openIssueSchema.strict()).parse(res.body.data);
    expect(Array.isArray(data)).toBe(true);
  });
});
