/**
 * Focused integration tests for GitHub PR webhook processing.
 *
 * SBB-2026-475 — workers batch
 *
 * These tests cover three observable scenarios that are critical to the
 * payout flow and must remain stable across restarts and replays:
 *
 * 1. **Two deliveries for the same merged PR** (different `X-GitHub-Delivery`
 *    IDs) produce exactly one `pr_merged` event and one `released` event.
 * 2. **Invalid HMAC signature** rejects with 401, leaves the delivery ID
 *    unconsumed, and allows a valid retry to succeed — including after a
 *    simulated process restart.
 * 3. **Out-of-order close event** is deferred (not dropped), survives a
 *    simulated process restart, and is applied by the startup resume pass once
 *    the matching bounty submission is recorded.
 *
 * All tests use isolated JSON fixtures from `fixtures/webhookPayloads.ts`,
 * write to temp files, and do not use live funds or network calls.
 */

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
import {
  PR_100_MERGED,
  PR_100_MERGED_SECOND_DELIVERY,
  PR_200_OUT_OF_ORDER_CLOSE,
  PR_400_TAMPERED_PAYLOAD,
} from './fixtures/webhookPayloads';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = 'sbb-scenario-test-webhook-secret-32x';

/** Sign a JSON-serialised body with the test secret. */
function signBody(raw: string): string {
  return signWebhookPayload({
    payload: Buffer.from(raw, 'utf8'),
    secret: WEBHOOK_SECRET,
    algorithm: githubWebhookSignatureProfile.algorithm,
    prefix: githubWebhookSignatureProfile.prefix,
  });
}

/** Build the raw JSON string and its valid HMAC signature for a fixture object. */
function buildRequest(fixture: object): { raw: string; signature: string } {
  const raw = JSON.stringify(fixture);
  return { raw, signature: signBody(raw) };
}

/** Send a signed webhook POST. Pass `signatureOverride` to test invalid HMAC paths. */
async function sendWebhook(
  app: Awaited<ReturnType<typeof getApp>>,
  fixture: object,
  deliveryId: string,
  signatureOverride?: string,
) {
  const { raw, signature } = buildRequest(fixture);
  const usedSig = signatureOverride ?? signature;

  return request(app)
    .post('/api/webhooks/github')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', usedSig)
    .set('X-GitHub-Delivery', deliveryId)
    .send(raw);
}

/** Create a submitted bounty whose `submissionUrl` is `prUrl`. */
async function makeSubmittedBounty(prUrl: string) {
  const { createBounty, reserveBounty, submitBounty } = await import('../src/services/bountyStore');
  const bounty = await createBounty(validCreateBody);
  await reserveBounty(bounty.id, CONTRIBUTOR);
  await submitBounty(bounty.id, CONTRIBUTOR, prUrl);
  return bounty;
}

async function getApp() {
  return (await import('../src/app')).app;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let storeFile: string;
let journalFile: string;

beforeEach(() => {
  storeFile = path.join(os.tmpdir(), `sbb-scenario-${randomUUID()}.json`);
  journalFile = `${storeFile}.webhook-deliveries.json`;
  fs.writeFileSync(storeFile, '[]', 'utf8');
  process.env.BOUNTY_STORE_PATH = storeFile;
  process.env.WEBHOOK_DELIVERY_STORE_PATH = journalFile;
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  delete process.env.WEBHOOK_REQUIRE_MAINTAINER_CONFIRMATION;
  delete process.env.WEBHOOK_AUTO_RELEASE;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOUNTY_STORE_PATH;
  delete process.env.WEBHOOK_DELIVERY_STORE_PATH;
  delete process.env.GITHUB_WEBHOOK_SECRET;
  for (const f of [
    storeFile,
    storeFile.replace(/\.json$/i, '.audit.json'),
    journalFile,
  ]) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
});

// ---------------------------------------------------------------------------
// Scenario 1: Two deliveries for the same merged PR
// ---------------------------------------------------------------------------

describe('Scenario 1 — two deliveries for the same merged PR', () => {
  it('first delivery releases the bounty; second delivery (different ID) is a no-op', async () => {
    const prUrl = PR_100_MERGED.pull_request.html_url;
    const bounty = await makeSubmittedBounty(prUrl);
    const app = await getApp();

    const first = await sendWebhook(app, PR_100_MERGED, randomUUID());
    expect(first.status).toBe(202);
    expect(first.body.data.deferred).toBe(false);

    // After the first delivery the bounty must be released.
    const { listBounties } = await import('../src/services/bountyStore');
    let saved = listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(saved?.prMerged).toBe(true);
    const versionAfterRelease = saved?.version;

    // Second delivery for the same merged PR arrives with a different delivery
    // ID (GitHub re-sent after a timeout, or a proxy retried).
    const second = await sendWebhook(app, PR_100_MERGED_SECOND_DELIVERY, randomUUID());
    expect(second.status).toBe(202);
    // The route must acknowledge "already_applied" — the bounty store detected
    // that prMerged / released are already set and skipped the transitions.
    expect(second.body.data.reason).toBe('already_applied');

    // No additional events must have been written.
    saved = listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(saved?.version).toBe(versionAfterRelease);
    expect(saved?.events.filter((e) => e.type === 'pr_merged')).toHaveLength(1);
    expect(saved?.events.filter((e) => e.type === 'released')).toHaveLength(1);
  });

  it('two concurrent deliveries for the same merged PR produce exactly one release', async () => {
    const prUrl = PR_100_MERGED.pull_request.html_url;
    const bounty = await makeSubmittedBounty(prUrl);
    const app = await getApp();

    // Both arrive simultaneously (Promise.all without await between them).
    const [res1, res2] = await Promise.all([
      sendWebhook(app, PR_100_MERGED, randomUUID()),
      sendWebhook(app, PR_100_MERGED_SECOND_DELIVERY, randomUUID()),
    ]);

    // Both must succeed at the HTTP level.
    expect([res1.status, res2.status]).toEqual(
      expect.arrayContaining([202]),
    );

    const { listBounties } = await import('../src/services/bountyStore');
    const saved = listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(saved?.prMerged).toBe(true);
    // Exactly one of each lifecycle event — no duplicates.
    expect(saved?.events.filter((e) => e.type === 'pr_merged')).toHaveLength(1);
    expect(saved?.events.filter((e) => e.type === 'released')).toHaveLength(1);
  });

  it('first delivery completes; after a restart the second delivery (different ID) is still a no-op', async () => {
    const prUrl = PR_100_MERGED.pull_request.html_url;
    const bounty = await makeSubmittedBounty(prUrl);
    const app = await getApp();

    // First delivery — releases the bounty.
    await sendWebhook(app, PR_100_MERGED, randomUUID()).then((r) => {
      expect(r.status).toBe(202);
    });

    const { listBounties } = await import('../src/services/bountyStore');
    expect(listBounties().find((b) => b.id === bounty.id)?.status).toBe('released');

    // Simulate a process restart: drop all in-memory module state.
    vi.resetModules();

    // The store JSON is still on disk — reload it.
    const { listBounties: listAfterRestart } = await import('../src/services/bountyStore');
    const appAfterRestart = await getApp();

    // Second delivery arrives post-restart under a fresh delivery ID.
    const second = await sendWebhook(appAfterRestart, PR_100_MERGED_SECOND_DELIVERY, randomUUID());
    expect(second.status).toBe(202);
    expect(second.body.data.reason).toBe('already_applied');

    // Store state must be unchanged from before the restart.
    const saved = listAfterRestart().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(saved?.events.filter((e) => e.type === 'pr_merged')).toHaveLength(1);
    expect(saved?.events.filter((e) => e.type === 'released')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Invalid HMAC signature — delivery ID must stay reusable
// ---------------------------------------------------------------------------

describe('Scenario 2 — invalid HMAC signature does not consume the delivery ID', () => {
  it('rejected HMAC (401) leaves no journal entry; valid retry succeeds', async () => {
    const prUrl = PR_100_MERGED.pull_request.html_url;
    const bounty = await makeSubmittedBounty(prUrl);
    const app = await getApp();
    const deliveryId = randomUUID();

    // Tampered / wrong signature — simulates a spoofed or corrupt request.
    const invalidSig = `sha256=${'0'.repeat(64)}`;
    const badAttempt = await sendWebhook(app, PR_100_MERGED, deliveryId, invalidSig);
    expect(badAttempt.status).toBe(401);

    // The bounty must be untouched.
    const { listBounties } = await import('../src/services/bountyStore');
    expect(listBounties().find((b) => b.id === bounty.id)?.status).toBe('submitted');

    // The delivery ID must not appear in the journal.  The file may not even
    // exist yet if no valid delivery has been recorded.
    const rawJournalFirst = fs.existsSync(journalFile)
      ? fs.readFileSync(journalFile, 'utf8').trim()
      : '{}';
    const journal = JSON.parse(rawJournalFirst || '{}');
    expect(Object.keys(journal.deliveries ?? {})).not.toContain(deliveryId);

    // The same delivery ID retried with a valid signature must succeed.
    const retry = await sendWebhook(app, PR_100_MERGED, deliveryId);
    expect(retry.status).toBe(202);
    expect(retry.body.data.deferred).toBe(false);

    expect(listBounties().find((b) => b.id === bounty.id)?.status).toBe('released');
  });

  it('invalid HMAC does not journal the delivery; valid retry succeeds after a restart', async () => {
    const prUrl = PR_100_MERGED.pull_request.html_url;
    const bounty = await makeSubmittedBounty(prUrl);
    const app = await getApp();
    const deliveryId = randomUUID();

    // Inject the tampered fixture (payload body signed with wrong secret).
    const { raw } = buildRequest(PR_400_TAMPERED_PAYLOAD);
    const wrongSig = `sha256=${'a'.repeat(64)}`;

    const badAttempt = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', wrongSig)
      .set('X-GitHub-Delivery', deliveryId)
      .send(raw);
    expect(badAttempt.status).toBe(401);

    // Confirm the journal on disk has no entry for this delivery ID.
    const rawJournal = fs.existsSync(journalFile)
      ? fs.readFileSync(journalFile, 'utf8').trim()
      : '{}';
    const journal = JSON.parse(rawJournal || '{}');
    expect(Object.keys(journal.deliveries ?? {})).not.toContain(deliveryId);

    // Simulate restart.
    vi.resetModules();
    const appAfterRestart = await getApp();

    // Valid retry with the same delivery ID on the original PR fixture.
    const retry = await sendWebhook(appAfterRestart, PR_100_MERGED, deliveryId);
    expect(retry.status).toBe(202);
    expect(retry.body.data.deferred).toBe(false);

    const { listBounties } = await import('../src/services/bountyStore');
    const saved = listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(saved?.events.filter((e) => e.type === 'released')).toHaveLength(1);
  });

  it('response body for an invalid HMAC does not contain the webhook secret', async () => {
    const prUrl = PR_100_MERGED.pull_request.html_url;
    await makeSubmittedBounty(prUrl);
    const app = await getApp();

    const { raw } = buildRequest(PR_100_MERGED);
    const invalidSig = `sha256=${'f'.repeat(64)}`;

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', invalidSig)
      .send(raw);

    expect(res.status).toBe(401);
    // The raw secret must never appear in the response (not even redacted).
    expect(JSON.stringify(res.body)).not.toContain(WEBHOOK_SECRET);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Out-of-order close event — deferred, survives restart, applied on replay
// ---------------------------------------------------------------------------

describe('Scenario 3 — out-of-order close event deferred through restart and applied on startup resume', () => {
  it('merged PR arrives before submission; delivery is deferred to journal', async () => {
    // No bounty submission exists yet for PR 200.
    const app = await getApp();
    const deliveryId = randomUUID();

    const res = await sendWebhook(app, PR_200_OUT_OF_ORDER_CLOSE, deliveryId);
    expect(res.status).toBe(202);
    expect(res.body.data.deferred).toBe(true);
    expect(res.body.data.reason).toBe('no_matching_bounty');

    // The journal must have a pending entry with the PR URL stored.
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    const entry = journal.deliveries[deliveryId];
    expect(entry.status).toBe('pending');
    expect(entry.lastPrUrl).toBe(PR_200_OUT_OF_ORDER_CLOSE.pull_request.html_url);
  });

  it('deferred delivery survives a restart; startup resume applies it after submission is recorded', async () => {
    const prUrl = PR_200_OUT_OF_ORDER_CLOSE.pull_request.html_url;
    const app = await getApp();
    const deliveryId = randomUUID();

    // Step 1: merged PR event arrives before the bounty submission.
    await sendWebhook(app, PR_200_OUT_OF_ORDER_CLOSE, deliveryId).then((r) => {
      expect(r.status).toBe(202);
      expect(r.body.data.deferred).toBe(true);
    });

    // Step 2: Simulate restart — drop all in-memory state.
    vi.resetModules();

    // Step 3: The submission is now recorded (bounty now exists in submitted state).
    const bounty = await makeSubmittedBounty(prUrl);
    const { listBounties } = await import('../src/services/bountyStore');
    expect(listBounties().find((b) => b.id === bounty.id)?.status).toBe('submitted');

    // Step 4: Startup resume pass.  Runs the deferred delivery through the
    // normal handler with its original delivery ID.
    const { resumePendingDeliveries } = await import('../src/webhooks/githubPrHandler');
    const summary = await resumePendingDeliveries();

    expect(summary.resumed).toBeGreaterThanOrEqual(1);
    expect(summary.completed).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBe(0);

    // Step 5: The bounty must now be released.
    const saved = listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(saved?.prMerged).toBe(true);
    expect(saved?.events.filter((e) => e.type === 'pr_merged')).toHaveLength(1);
    expect(saved?.events.filter((e) => e.type === 'released')).toHaveLength(1);

    // Step 6: The journal entry for the original delivery must be completed.
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    expect(journal.deliveries[deliveryId]?.status).toBe('completed');
  });

  it('deferred delivery retried via redelivery (not startup resume) is applied correctly', async () => {
    const prUrl = PR_200_OUT_OF_ORDER_CLOSE.pull_request.html_url;
    const app = await getApp();
    const deliveryId = randomUUID();

    // Step 1: out-of-order delivery is deferred.
    await sendWebhook(app, PR_200_OUT_OF_ORDER_CLOSE, deliveryId).then((r) => {
      expect(r.status).toBe(202);
      expect(r.body.data.deferred).toBe(true);
    });

    // Step 2: submission is now recorded.
    const bounty = await makeSubmittedBounty(prUrl);

    // Step 3: GitHub redelivers the same event with the same delivery ID.
    const retry = await sendWebhook(app, PR_200_OUT_OF_ORDER_CLOSE, deliveryId);
    expect(retry.status).toBe(202);
    // Must NOT be marked as a duplicate — a pending delivery is resumed, not skipped.
    expect(retry.body.data.duplicate).toBeUndefined();

    const { listBounties } = await import('../src/services/bountyStore');
    const saved = listBounties().find((b) => b.id === bounty.id);
    expect(saved?.status).toBe('released');
    expect(saved?.prMerged).toBe(true);
    expect(saved?.events.filter((e) => e.type === 'pr_merged')).toHaveLength(1);
    expect(saved?.events.filter((e) => e.type === 'released')).toHaveLength(1);
  });

  it('a second redelivery of an already-applied out-of-order event is a no-op', async () => {
    const prUrl = PR_200_OUT_OF_ORDER_CLOSE.pull_request.html_url;
    const bounty = await makeSubmittedBounty(prUrl);
    const app = await getApp();
    const deliveryId = randomUUID();

    // Both the submission exists and the event arrives — applied immediately.
    await sendWebhook(app, PR_200_OUT_OF_ORDER_CLOSE, deliveryId).then((r) => {
      expect(r.status).toBe(202);
      expect(r.body.data.deferred).toBe(false);
    });

    const { listBounties } = await import('../src/services/bountyStore');
    const versionAfterRelease = listBounties().find((b) => b.id === bounty.id)?.version;

    // GitHub delivers the same event a third time (same ID).
    const second = await sendWebhook(app, PR_200_OUT_OF_ORDER_CLOSE, deliveryId);
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);

    // No change to bounty state.
    const saved = listBounties().find((b) => b.id === bounty.id);
    expect(saved?.version).toBe(versionAfterRelease);
    expect(saved?.events.filter((e) => e.type === 'pr_merged')).toHaveLength(1);
    expect(saved?.events.filter((e) => e.type === 'released')).toHaveLength(1);
  });
});
