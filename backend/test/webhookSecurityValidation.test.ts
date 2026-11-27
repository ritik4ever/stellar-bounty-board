import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRIBUTOR, validCreateBody } from './fixtures';
import {
  githubWebhookSignatureProfile,
  signWebhookPayload,
} from '../src/webhooks/signatureVerification';
import { getPendingDeliveries } from '../src/webhooks/deliveryDedup';

const secret = 'test-github-webhook-secret-99';

let storeFile: string;
let journalFile: string;

function createGitHubSignature(payload: Buffer, customSecret = secret): string {
  return signWebhookPayload({
    payload,
    secret: customSecret,
    algorithm: githubWebhookSignatureProfile.algorithm,
    prefix: githubWebhookSignatureProfile.prefix,
  });
}

async function getApp() {
  return (await import('../src/app')).app;
}

async function getStore() {
  return import('../src/services/bountyStore');
}

function removeFileIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function mergedPrPayload(prUrl: string, merged = true) {
  return { action: 'closed', pull_request: { html_url: prUrl, merged } };
}

describe('GitHub webhook security and input validation (#1942)', () => {
  beforeEach(() => {
    storeFile = path.join(os.tmpdir(), `bounty-security-test-${randomUUID()}.json`);
    journalFile = `${storeFile}.webhook-deliveries.json`;
    fs.writeFileSync(storeFile, '[]', 'utf8');
    process.env.BOUNTY_STORE_PATH = storeFile;
    process.env.WEBHOOK_DELIVERY_STORE_PATH = journalFile;
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    delete process.env.WEBHOOK_REQUIRE_MAINTAINER_CONFIRMATION;
    delete process.env.WEBHOOK_AUTO_RELEASE;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.BOUNTY_STORE_PATH;
    delete process.env.WEBHOOK_DELIVERY_STORE_PATH;
    delete process.env.GITHUB_WEBHOOK_SECRET;

    removeFileIfExists(storeFile);
    removeFileIfExists(storeFile.replace(/\.json$/i, '.audit.json'));
    removeFileIfExists(journalFile);
  });

  it('rejects unauthenticated requests with invalid or missing HMAC signatures without altering state or leaking secret', async () => {
    const { createBounty, reserveBounty, submitBounty, listBounties } = await getStore();
    const prUrl = 'https://github.com/owner/repo-name/pull/501';
    const bounty = await createBounty(validCreateBody);
    await reserveBounty(bounty.id, CONTRIBUTOR);
    await submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    const app = await getApp();
    const rawPayload = JSON.stringify(mergedPrPayload(prUrl));

    // 1. Missing signature header
    const missingSigRes = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Delivery', randomUUID())
      .send(rawPayload);

    expect(missingSigRes.status).toBe(401);
    expect(missingSigRes.body.error).toContain('Missing GitHub webhook signature');
    expect(JSON.stringify(missingSigRes.body)).not.toContain(secret);

    // 2. Invalid HMAC signature
    const invalidSigRes = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${'f'.repeat(64)}`)
      .set('X-GitHub-Delivery', randomUUID())
      .send(rawPayload);

    expect(invalidSigRes.status).toBe(401);
    expect(invalidSigRes.body.error).toContain('Invalid GitHub webhook signature');
    expect(JSON.stringify(invalidSigRes.body)).not.toContain(secret);

    // Verify bounty state is untouched
    const saved = listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('submitted');
    expect(saved?.version).toBe(3);
    expect(saved?.events.filter((e) => e.type === 'released')).toHaveLength(0);
  });

  it('rejects malformed X-GitHub-Delivery headers with 400 Bad Request', async () => {
    const app = await getApp();
    const prUrl = 'https://github.com/owner/repo-name/pull/502';
    const rawPayload = JSON.stringify(mergedPrPayload(prUrl));
    const signature = createGitHubSignature(Buffer.from(rawPayload, 'utf8'));

    // Delivery ID with path traversal / special characters
    const resTraversal = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .set('X-GitHub-Delivery', '../../evil/path')
      .send(rawPayload);

    expect(resTraversal.status).toBe(400);
    expect(resTraversal.body.error).toBe('Invalid X-GitHub-Delivery header');

    // Delivery ID with spaces / script tags
    const resScript = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .set('X-GitHub-Delivery', 'delivery<script>')
      .send(rawPayload);

    expect(resScript.status).toBe(400);
    expect(resScript.body.error).toBe('Invalid X-GitHub-Delivery header');

    // Delivery ID with excessive length
    const resOverlong = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .set('X-GitHub-Delivery', 'a'.repeat(300))
      .send(rawPayload);

    expect(resOverlong.status).toBe(400);
    expect(resOverlong.body.error).toBe('Invalid X-GitHub-Delivery header');
  });

  it('rejects malformed non-object JSON bodies with 400 Bad Request', async () => {
    const app = await getApp();
    const rawArrayPayload = JSON.stringify(['not', 'an', 'object']);
    const signature = createGitHubSignature(Buffer.from(rawArrayPayload, 'utf8'));

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(rawArrayPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Malformed webhook payload: body must be a JSON object');
  });

  it('rejects malformed PR URLs with 400 Bad Request and does not defer them into the delivery journal', async () => {
    const app = await getApp();
    const maliciousUrls = [
      'javascript:alert(1)',
      'http://insecure.test/owner/repo/pull/1',
      'https://notgithub.com/owner/repo/pull/1',
      'not-a-valid-url',
    ];

    for (const badUrl of maliciousUrls) {
      const deliveryId = randomUUID();
      const rawPayload = JSON.stringify(mergedPrPayload(badUrl));
      const signature = createGitHubSignature(Buffer.from(rawPayload, 'utf8'));

      const res = await request(app)
        .post('/api/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .set('X-GitHub-Delivery', deliveryId)
        .send(rawPayload);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Malformed webhook payload: invalid pull_request.html_url');

      // Crucial security guarantee: must NOT defer malformed URLs for retry in journal
      const pending = getPendingDeliveries();
      expect(pending.some((d) => d.deliveryId === deliveryId)).toBe(false);
    }
  });

  it('correctly defers legitimate out-of-order close events with valid PR URLs for retry', async () => {
    const app = await getApp();
    const validPrUrl = 'https://github.com/owner/repo-name/pull/777';
    const deliveryId = randomUUID();
    const rawPayload = JSON.stringify(mergedPrPayload(validPrUrl));
    const signature = createGitHubSignature(Buffer.from(rawPayload, 'utf8'));

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .set('X-GitHub-Delivery', deliveryId)
      .send(rawPayload);

    expect(res.status).toBe(202);
    expect(res.body.data.deferred).toBe(true);
    expect(res.body.data.reason).toBe('no_matching_bounty');

    const pending = getPendingDeliveries();
    expect(pending.some((d) => d.deliveryId === deliveryId && d.prUrl === validPrUrl)).toBe(true);
  });

  it('safely handles two deliveries for the same merged PR without duplicating transitions, and rejects untrusted alterations', async () => {
    const { createBounty, reserveBounty, submitBounty, listBounties } = await getStore();
    const prUrl = 'https://github.com/owner/repo-name/pull/555';
    const bounty = await createBounty(validCreateBody);
    await reserveBounty(bounty.id, CONTRIBUTOR);
    await submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    const app = await getApp();
    const rawPayload = JSON.stringify(mergedPrPayload(prUrl));
    const validSignature = createGitHubSignature(Buffer.from(rawPayload, 'utf8'));

    // First delivery — valid signature and payload
    const firstDeliveryId = randomUUID();
    const firstRes = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', validSignature)
      .set('X-GitHub-Delivery', firstDeliveryId)
      .send(rawPayload);

    expect(firstRes.status).toBe(202);
    let currentBounty = listBounties().find((b) => b.id === bounty.id);
    expect(currentBounty?.status).toBe('released');
    expect(currentBounty?.events.filter((e) => e.type === 'released')).toHaveLength(1);
    const versionAfterFirstRelease = currentBounty?.version;

    // Second delivery for the same merged PR with a new delivery ID
    const secondDeliveryId = randomUUID();
    const secondRes = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', validSignature)
      .set('X-GitHub-Delivery', secondDeliveryId)
      .send(rawPayload);

    expect(secondRes.status).toBe(202);
    expect(secondRes.body.data.reason).toBe('already_applied');

    currentBounty = listBounties().find((b) => b.id === bounty.id);
    expect(currentBounty?.version).toBe(versionAfterFirstRelease);
    expect(currentBounty?.events.filter((e) => e.type === 'released')).toHaveLength(1);

    // Third delivery: an untrusted caller tries to alter the request with an invalid signature
    const tamperedRes = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${'0'.repeat(64)}`)
      .set('X-GitHub-Delivery', randomUUID())
      .send(rawPayload);

    expect(tamperedRes.status).toBe(401);
    currentBounty = listBounties().find((b) => b.id === bounty.id);
    expect(currentBounty?.version).toBe(versionAfterFirstRelease);
    expect(currentBounty?.events.filter((e) => e.type === 'released')).toHaveLength(1);
  });
});
