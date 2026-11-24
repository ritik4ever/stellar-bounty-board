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

const secret = 'github-webhook-secret';

let storeFile: string;
let journalFile: string;

function createGitHubSignature(payload: Buffer): string {
  return signWebhookPayload({
    payload,
    secret,
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

async function getDedup() {
  return import('../src/webhooks/deliveryDedup');
}

async function getHandler() {
  return import('../src/webhooks/githubPrHandler');
}

function removeFileIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function mergedPrPayload(prUrl: string) {
  return { action: 'closed', pull_request: { html_url: prUrl, merged: true } };
}

function sendMergedPr(
  app: Awaited<ReturnType<typeof getApp>>,
  prUrl: string,
  deliveryId?: string,
  signatureOverride?: string
) {
  const rawPayload = JSON.stringify(mergedPrPayload(prUrl));
  const signature = signatureOverride ?? createGitHubSignature(Buffer.from(rawPayload, 'utf8'));

  const req = request(app)
    .post('/api/webhooks/github')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', signature);

  if (deliveryId) {
    req.set('X-GitHub-Delivery', deliveryId);
  }

  return req.send(rawPayload);
}

async function submitBountyWithPr(prUrl: string) {
  const { createBounty, reserveBounty, submitBounty } = await getStore();
  const bounty = await createBounty(validCreateBody);
  await reserveBounty(bounty.id, CONTRIBUTOR);
  await submitBounty(bounty.id, CONTRIBUTOR, prUrl);
  return bounty;
}

describe('GitHub webhook delivery journal — interruption, restart and retry safety', () => {
  beforeEach(() => {
    storeFile = path.join(os.tmpdir(), `bounty-webhook-resume-${randomUUID()}.json`);
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

  it('defaults the journal next to the bounty store', async () => {
    delete process.env.WEBHOOK_DELIVERY_STORE_PATH;
    const { getDeliveryJournalPath } = await getDedup();

    expect(getDeliveryJournalPath()).toBe(
      path.resolve(storeFile).replace(/\.json$/i, '.webhook-deliveries.json')
    );
  });

  it('persists completed deliveries across a restart and does not re-release on redelivery', async () => {
    const prUrl = 'https://github.com/owner/repo-name/pull/9001';
    const deliveryId = randomUUID();

    const bounty = await submitBountyWithPr(prUrl);
    const app = await getApp();

    await sendMergedPr(app, prUrl, deliveryId).expect(202);

    let saved = (await getStore()).listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');

    // Simulate a process restart: module state (including the in-memory journal
    // view) is dropped, but the on-disk journal survives.
    vi.resetModules();
    const { hasBeenProcessed } = await getDedup();
    expect(hasBeenProcessed(deliveryId)).toBe(true);

    const restartedApp = await getApp();
    const replay = await sendMergedPr(restartedApp, prUrl, deliveryId);

    expect(replay.status).toBe(200);
    expect(replay.body.data.duplicate).toBe(true);

    saved = (await getStore()).listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(saved?.events.filter((event) => event.type === 'released')).toHaveLength(1);
    expect(saved?.events.filter((event) => event.type === 'pr_merged')).toHaveLength(1);
  });

  it('defers an out-of-order merged PR event and applies it when redelivered', async () => {
    const prUrl = 'https://github.com/owner/repo-name/pull/9002';
    const deliveryId = randomUUID();

    const app = await getApp();

    // The PR is merged before the submission that references it is committed.
    const first = await sendMergedPr(app, prUrl, deliveryId);
    expect(first.status).toBe(202);
    expect(first.body.data.deferred).toBe(true);
    expect(first.body.data.reason).toBe('no_matching_bounty');

    const { getPendingDeliveries } = await getDedup();
    const pending = getPendingDeliveries();
    expect(pending).toHaveLength(1);
    expect(pending[0].deliveryId).toBe(deliveryId);
    expect(pending[0].prUrl).toBe(prUrl);

    // The submission is recorded afterwards.
    const bounty = await submitBountyWithPr(prUrl);

    // GitHub redelivers the same event; it must be resumed, not treated as a
    // duplicate and not dropped.
    const second = await sendMergedPr(app, prUrl, deliveryId);
    expect(second.status).toBe(202);
    expect(second.body.data.duplicate).toBeUndefined();

    const saved = (await getStore()).listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(getPendingDeliveries()).toHaveLength(0);
  });

  it('resumes a delivery whose worker died mid-processing after a restart', async () => {
    const prUrl = 'https://github.com/owner/repo-name/pull/9003';
    const deliveryId = randomUUID();

    const bounty = await submitBountyWithPr(prUrl);

    // A worker claimed the delivery, then the process died before committing or
    // completing anything.
    const { beginDelivery, hasBeenProcessed } = await getDedup();
    expect(beginDelivery(deliveryId, { prUrl }).decision).toBe('new');
    expect(hasBeenProcessed(deliveryId)).toBe(false);

    vi.resetModules();

    const app = await getApp();
    const retry = await sendMergedPr(app, prUrl, deliveryId);

    expect(retry.status).toBe(202);
    expect(retry.body.data.duplicate).toBeUndefined();

    const saved = (await getStore()).listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');

    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    expect(journal.version).toBe(1);
    expect(journal.deliveries[deliveryId].status).toBe('completed');
    expect(journal.deliveries[deliveryId].attempts).toBe(2);
  });

  it('applies pending deliveries at startup without waiting for a GitHub redelivery', async () => {
    const prUrl = 'https://github.com/owner/repo-name/pull/9004';
    const deliveryId = randomUUID();

    const app = await getApp();
    await sendMergedPr(app, prUrl, deliveryId).expect(202);

    const bounty = await submitBountyWithPr(prUrl);

    // Restart, then run the startup resume pass.
    vi.resetModules();
    const { resumePendingDeliveries } = await getHandler();
    const summary = await resumePendingDeliveries();

    expect(summary.resumed).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.remaining).toBe(0);

    const saved = (await getStore()).listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(saved?.prMerged).toBe(true);
    expect(saved?.events.filter((event) => event.type === 'released')).toHaveLength(1);
  });

  it('does not duplicate events when a completed delivery is replayed after its completion was lost', async () => {
    const prUrl = 'https://github.com/owner/repo-name/pull/9005';
    const deliveryId = randomUUID();

    const bounty = await submitBountyWithPr(prUrl);
    const app = await getApp();
    await sendMergedPr(app, prUrl, deliveryId).expect(202);

    const versionAfterFirstDelivery = (await getStore())
      .listBounties()
      .find((b) => b.id === bounty.id)?.version;

    // Simulate a crash after the side effects committed but before the journal
    // recorded completion: force the record back to in_progress.
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    journal.deliveries[deliveryId] = {
      ...journal.deliveries[deliveryId],
      status: 'in_progress',
      updatedAt: Date.now(),
    };
    fs.writeFileSync(journalFile, JSON.stringify(journal), 'utf8');
    vi.resetModules();

    const restartedApp = await getApp();
    const replay = await sendMergedPr(restartedApp, prUrl, deliveryId);

    expect(replay.status).toBe(202);
    expect(replay.body.data.deferred).toBe(false);
    expect(replay.body.data.reason).toBe('already_applied');

    const saved = (await getStore()).listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(saved?.events.filter((event) => event.type === 'released')).toHaveLength(1);
    expect(saved?.events.filter((event) => event.type === 'pr_merged')).toHaveLength(1);
    // The replay must not have advanced the record version a second time.
    expect(saved?.version).toBe(versionAfterFirstDelivery);
  });

  it('treats a bounty released manually before the webhook arrives as success', async () => {
    const prUrl = 'https://github.com/owner/repo-name/pull/9006';
    const deliveryId = randomUUID();

    const bounty = await submitBountyWithPr(prUrl);
    const store = await getStore();
    await store.releaseBounty(bounty.id, bounty.maintainer);

    const app = await getApp();
    const response = await sendMergedPr(app, prUrl, deliveryId);

    expect(response.status).toBe(202);
    expect(response.body.data.deferred).toBe(false);

    const saved = store.listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(saved?.events.filter((event) => event.type === 'released')).toHaveLength(1);
  });

  it('rejects an invalid HMAC signature and still processes the retry', async () => {
    const prUrl = 'https://github.com/owner/repo-name/pull/9007';
    const deliveryId = randomUUID();

    const bounty = await submitBountyWithPr(prUrl);
    const app = await getApp();

    const tamperedSignature = `sha256=${'0'.repeat(64)}`;
    await sendMergedPr(app, prUrl, deliveryId, tamperedSignature).expect(401);

    let saved = (await getStore()).listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('submitted');

    // The rejected request must not have consumed the delivery ID.
    const retry = await sendMergedPr(app, prUrl, deliveryId);
    expect(retry.status).toBe(202);

    saved = (await getStore()).listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
  });

  it('keeps a deferred delivery pending when the retry still has no matching bounty', async () => {
    const prUrl = 'https://github.com/owner/repo-name/pull/9008';
    const deliveryId = randomUUID();

    const app = await getApp();
    await sendMergedPr(app, prUrl, deliveryId).expect(202);
    await sendMergedPr(app, prUrl, deliveryId).expect(202);

    const { getPendingDeliveries } = await getDedup();
    const pending = getPendingDeliveries();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
    expect(pending[0].attempts).toBe(2);
  });
});
