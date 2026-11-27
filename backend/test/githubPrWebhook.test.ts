import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRIBUTOR, MAINTAINER, validCreateBody } from './fixtures';
import {
  githubWebhookSignatureProfile,
  signWebhookPayload,
} from '../src/webhooks/signatureVerification';

const secret = 'github-webhook-secret';

let storeFile: string;

function createGitHubSignature(payload: Buffer): string {
  return signWebhookPayload({
    payload,
    secret,
    algorithm: githubWebhookSignatureProfile.algorithm,
    prefix: githubWebhookSignatureProfile.prefix,
  });
}

async function getApp() {
  const { app } = await import('../src/app');
  return app;
}

async function getStore() {
  return import('../src/services/bountyStore');
}

function removeFileIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

describe('GitHub webhook PR auto-release', () => {
  beforeEach(() => {
    storeFile = path.join(os.tmpdir(), `bounty-webhook-${randomUUID()}.json`);
    fs.writeFileSync(storeFile, '[]', 'utf8');
    process.env.BOUNTY_STORE_PATH = storeFile;
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.BOUNTY_STORE_PATH;
    delete process.env.GITHUB_WEBHOOK_SECRET;

    removeFileIfExists(storeFile);
    removeFileIfExists(storeFile.replace(/\.json$/i, '.audit.json'));
  });

  const validPrPayload = (htmlUrl: string, merged = true, action = 'closed') => ({
    action,
    pull_request: {
      html_url: htmlUrl,
      merged,
    },
  });

  it('Merged PR triggers bounty release automatically', async () => {
    const { createBounty, reserveBounty, submitBounty, listBounties } = await getStore();
    const app = await getApp();
    const prUrl = 'https://github.com/owner/repo-name/pull/100';

    const bounty = await createBounty(validCreateBody);
    await reserveBounty(bounty.id, CONTRIBUTOR);
    await submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    let saved = listBounties().find((item) => item.id === bounty.id);
    expect(saved?.status).toBe('submitted');

    const payload = validPrPayload(prUrl, true, 'closed');
    const rawPayload = JSON.stringify(payload);
    const signature = createGitHubSignature(Buffer.from(rawPayload, 'utf8'));

    await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(rawPayload)
      .expect(202);

    saved = listBounties().find((item) => item.id === bounty.id);
    expect(saved?.status).toBe('released');
  });

  it('Closed-but-not-merged PR does not trigger release', async () => {
    const { createBounty, reserveBounty, submitBounty, listBounties } = await getStore();
    const app = await getApp();
    const prUrl = 'https://github.com/owner/repo-name/pull/101';

    const bounty = await createBounty(validCreateBody);
    await reserveBounty(bounty.id, CONTRIBUTOR);
    await submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    const payload = validPrPayload(prUrl, false, 'closed');
    const rawPayload = JSON.stringify(payload);
    const signature = createGitHubSignature(Buffer.from(rawPayload, 'utf8'));

    await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(rawPayload)
      .expect(202);

    const saved = listBounties().find((item) => item.id === bounty.id);
    expect(saved?.status).toBe('submitted');
  });

  it('Bounty without matching PR URL is ignored gracefully', async () => {
    const { createBounty, reserveBounty, submitBounty, listBounties } = await getStore();
    const app = await getApp();
    const prUrl = 'https://github.com/owner/repo-name/pull/102';
    const differentPrUrl = 'https://github.com/owner/repo-name/pull/999';

    const bounty = await createBounty(validCreateBody);
    await reserveBounty(bounty.id, CONTRIBUTOR);
    await submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    const payload = validPrPayload(differentPrUrl, true, 'closed');
    const rawPayload = JSON.stringify(payload);
    const signature = createGitHubSignature(Buffer.from(rawPayload, 'utf8'));

    await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(rawPayload)
      .expect(202);

    const saved = listBounties().find((item) => item.id === bounty.id);
    expect(saved?.status).toBe('submitted');
  });

  it('Manual release still works if webhook was not received', async () => {
    const { createBounty, reserveBounty, submitBounty } = await getStore();
    const app = await getApp();
    const prUrl = 'https://github.com/owner/repo-name/pull/103';

    const bounty = await createBounty(validCreateBody);
    await reserveBounty(bounty.id, CONTRIBUTOR);
    await submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    const response = await request(app)
      .post(`/api/bounties/${bounty.id}/release`)
      .send({ maintainer: MAINTAINER, transactionHash: 'a'.repeat(64) })
      .expect(200);

    expect(response.body.data.status).toBe('released');
  });

  it("Duplicate delivery ID (at-least-once redelivery) returns 200 without re-processing", async () => {
    // Simulates GitHub's at-least-once delivery: the same X-GitHub-Delivery ID
    // arrives twice.  The second delivery must not trigger a second release.
    const { createBounty, reserveBounty, submitBounty, listBounties } = await getStore();
    const app = await getApp();
    const prUrl = 'https://github.com/owner/repo-name/pull/200';
    const deliveryId = randomUUID();

    const bounty = await createBounty(validCreateBody);
    await reserveBounty(bounty.id, CONTRIBUTOR);
    await submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    const payload = validPrPayload(prUrl, true, 'closed');
    const rawPayload = JSON.stringify(payload);
    const signature = createGitHubSignature(Buffer.from(rawPayload, 'utf8'));

    // First delivery — processed normally, bounty released
    const first = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .set('X-GitHub-Delivery', deliveryId)
      .send(rawPayload);

    expect(first.status).toBe(202);

    let saved = listBounties().find((item) => item.id === bounty.id);
    expect(saved?.status).toBe('released');

    // Second delivery — same delivery ID, must be a no-op returning 200
    const second = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .set('X-GitHub-Delivery', deliveryId)
      .send(rawPayload);

    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);

    // Status must remain 'released' (not fail due to double-release attempt)
    saved = listBounties().find((item) => item.id === bounty.id);
    expect(saved?.status).toBe('released');
  });

  it("New delivery ID after a prior one is processed normally", async () => {
    // Two distinct deliveries with different IDs must both be processed.
    const { createBounty, reserveBounty, submitBounty, listBounties } = await getStore();
    const app = await getApp();
    const prUrl1 = 'https://github.com/owner/repo-name/pull/300';
    const prUrl2 = 'https://github.com/owner/repo-name/pull/301';

    const bounty1 = await createBounty(validCreateBody);
    await reserveBounty(bounty1.id, CONTRIBUTOR);
    await submitBounty(bounty1.id, CONTRIBUTOR, prUrl1);

    const bounty2 = await createBounty(validCreateBody);
    await reserveBounty(bounty2.id, CONTRIBUTOR);
    await submitBounty(bounty2.id, CONTRIBUTOR, prUrl2);

    const makeRequest = async (prUrl: string, deliveryId: string) => {
      const payload = validPrPayload(prUrl, true, 'closed');
      const rawPayload = JSON.stringify(payload);
      const signature = createGitHubSignature(Buffer.from(rawPayload, 'utf8'));
      return request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .set('X-GitHub-Delivery', deliveryId)
        .send(rawPayload);
    };

    const res1 = await makeRequest(prUrl1, randomUUID());
    expect(res1.status).toBe(202);

    const res2 = await makeRequest(prUrl2, randomUUID());
    expect(res2.status).toBe(202);

    const saved1 = listBounties().find((item) => item.id === bounty1.id);
    const saved2 = listBounties().find((item) => item.id === bounty2.id);
    expect(saved1?.status).toBe('released');
    expect(saved2?.status).toBe('released');
  });
});
