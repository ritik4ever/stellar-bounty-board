import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { CONTRIBUTOR, MAINTAINER } from './fixtures';

let storeFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `usdc-bounty-test-${randomUUID()}.json`);
  fs.writeFileSync(storeFile, '[]', 'utf8');
  process.env.BOUNTY_STORE_PATH = storeFile;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  try {
    fs.unlinkSync(storeFile);
  } catch {
    // best effort
  }
  try {
    const auditStorePath = storeFile.replace(/\.json$/i, '.audit.json');
    fs.unlinkSync(auditStorePath);
  } catch {
    // best effort
  }
});

describe('USDC Bounty Lifecycle Integration Test', () => {
  it('creates, reserves, submits, and releases a USDC bounty successfully', async () => {
    // 1. Create a USDC bounty
    const createBody = {
      repo: 'owner/repo',
      issueNumber: 42,
      title: 'Implement USDC support for escrows',
      summary: 'Enable USDC payouts for resolved issue bounties in the board dashboard.',
      maintainer: MAINTAINER,
      tokenSymbol: 'USDC',
      amount: 250,
      deadlineDays: 14,
      labels: ['enhancement'],
    };

    const createRes = await request(app)
      .post('/api/bounties')
      .send(createBody)
      .expect(201);

    const bounty = createRes.body.data;
    expect(bounty).toBeDefined();
    expect(bounty.id).toBeDefined();
    expect(bounty.tokenSymbol).toBe('USDC');
    expect(bounty.tokenAddress).toBe('CCW677VKUVRVH25WJ3G7L2NKV6AEFBSFW4FG7L0XXXXXX');
    expect(bounty.status).toBe('open');

    // 2. Reserve the bounty
    const reserveRes = await request(app)
      .post(`/api/bounties/${bounty.id}/reserve`)
      .send({ contributor: CONTRIBUTOR })
      .expect(200);

    expect(reserveRes.body.data.status).toBe('reserved');
    expect(reserveRes.body.data.contributor).toBe(CONTRIBUTOR);

    // 3. Submit solution
    const submitRes = await request(app)
      .post(`/api/bounties/${bounty.id}/submit`)
      .send({
        contributor: CONTRIBUTOR,
        submissionUrl: 'https://github.com/owner/repo/pull/42',
        notes: 'USDC multi token support completed and tested.',
      })
      .expect(200);

    expect(submitRes.body.data.status).toBe('submitted');

    // 4. Release payment
    const releaseRes = await request(app)
      .post(`/api/bounties/${bounty.id}/release`)
      .send({
        maintainer: MAINTAINER,
        transactionHash: 'b'.repeat(64),
      })
      .expect(200);

    expect(releaseRes.body.data.status).toBe('released');
    expect(releaseRes.body.data.releasedTxHash).toBe('b'.repeat(64));
  });
});
