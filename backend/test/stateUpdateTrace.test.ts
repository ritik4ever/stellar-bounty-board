import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STATE_UPDATE_TRACE_EVENT,
  buildStateUpdateTrace,
  createStateUpdateTrace,
  redactReference,
  setGlobalStateUpdateTraceSink,
  traceWebhookOutcome,
  type StateUpdateTraceRecord,
} from '../src/services/stateUpdateTrace';

const MAINTAINER = 'GB5IWBA6RTXMZSCMHFSVNL6IIZMHH5WJOH7JXZ2UTZD3VP2WBVWJJOOK';
const CONTRIBUTOR = 'GBE6AZEUPV75O3Z7OFW4RIMU7DF453AVK5HCXB3PV2I7BBTYEPCOYWSF';

describe('redactReference (#1928)', () => {
  it('maps strings to a stable, truncated sha256 reference', () => {
    const first = redactReference('delivery-req-12345');
    expect(first).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(redactReference('delivery-req-12345')).toBe(first);
    expect(redactReference('delivery-req-99999')).not.toBe(first);
  });

  it('never echoes secret keys or raw sensitive tokens', () => {
    const secretKey = 'SB3KMXQW7X2E2Y6Z7A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T';
    const redacted = redactReference(secretKey);
    expect(redacted).not.toContain(secretKey);
    expect(redacted).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  it('returns null for non-string or whitespace-only inputs', () => {
    expect(redactReference(undefined)).toBeNull();
    expect(redactReference(null)).toBeNull();
    expect(redactReference('')).toBeNull();
    expect(redactReference('   ')).toBeNull();
    expect(redactReference(12345)).toBeNull();
  });

  it('preserves an already-redacted reference without double-hashing', () => {
    const existing = 'sha256:0123456789abcdef';
    expect(redactReference(existing)).toBe(existing);
  });
});

describe('buildStateUpdateTrace (#1928)', () => {
  it('builds a redacted trace record with public metadata only', () => {
    const record = buildStateUpdateTrace({
      outcome: 'pending',
      bountyId: 'BNT-0001',
      transition: 'reserve',
      eventRef: 'raw-event-id-123',
      deliveryRef: 'raw-delivery-abc',
      cursorRef: 'raw-cursor-token',
      expectedVersion: 1,
      currentVersion: 1,
      fromStatus: 'open',
      actor: CONTRIBUTOR,
      workerId: 'worker-a',
    });

    expect(record).toMatchObject({
      event: STATE_UPDATE_TRACE_EVENT,
      outcome: 'pending',
      bountyId: 'BNT-0001',
      transition: 'reserve',
      expectedVersion: 1,
      currentVersion: 1,
      fromStatus: 'open',
      toStatus: null,
      workerId: 'worker-a',
    });

    expect(record.eventRef).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(record.deliveryRef).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(record.cursorRef).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(record.actorRef).toMatch(/^sha256:[0-9a-f]{16}$/);

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('raw-event-id-123');
    expect(serialized).not.toContain('raw-delivery-abc');
    expect(serialized).not.toContain('raw-cursor-token');
  });

  it('auto-generates eventRef when omitted', () => {
    const record = buildStateUpdateTrace({
      outcome: 'committed',
      bountyId: 'BNT-0002',
      transition: 'refund',
      expectedVersion: 1,
      currentVersion: 2,
    });

    expect(record.eventRef).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  it('throws a TypeError for invalid outcome', () => {
    expect(() =>
      buildStateUpdateTrace({
        outcome: 'completed' as any,
        bountyId: 'BNT-0001',
        transition: 'reserve',
      })
    ).toThrow(/unknown state update trace outcome/);
  });
});

describe('createStateUpdateTrace (#1928)', () => {
  it('emits pending, committed, and failed records through the sink', () => {
    const captured: StateUpdateTraceRecord[] = [];
    const emitter = createStateUpdateTrace((r) => captured.push(r));

    emitter.pending({
      bountyId: 'BNT-0001',
      transition: 'reserve',
      eventRef: 'ref-1',
      expectedVersion: 1,
    });
    emitter.committed({
      bountyId: 'BNT-0001',
      transition: 'reserve',
      eventRef: 'ref-1',
      expectedVersion: 1,
      currentVersion: 2,
    });
    emitter.failed({
      bountyId: 'BNT-0001',
      transition: 'reserve',
      eventRef: 'ref-1',
      expectedVersion: 1,
      currentVersion: 2,
      error: 'BOUNTY_VERSION_CONFLICT',
    });

    expect(captured.map((c) => c.outcome)).toEqual(['pending', 'committed', 'failed']);
    expect(captured[0].eventRef).toBe(captured[1].eventRef);
    expect(captured[1].eventRef).toBe(captured[2].eventRef);
    expect(captured[2].error).toBe('BOUNTY_VERSION_CONFLICT');
  });
});

describe('concurrent bounty state update tracing integration (#1928)', () => {
  let storeFile: string;
  let capturedTraces: StateUpdateTraceRecord[] = [];

  beforeEach(() => {
    storeFile = path.join(os.tmpdir(), `trace-bounties-${randomUUID()}.json`);
    fs.writeFileSync(storeFile, '[]', 'utf8');
    process.env.BOUNTY_STORE_PATH = storeFile;
    process.env.BOUNTY_AUDIT_STORE_PATH = storeFile.replace(/\.json$/i, '.audit.json');
    process.env.STORE_LOCK_TIMEOUT_MS = '5000';
    capturedTraces = [];
    setGlobalStateUpdateTraceSink((rec) => capturedTraces.push(rec));
  });

  afterEach(() => {
    setGlobalStateUpdateTraceSink(null);
    delete process.env.BOUNTY_STORE_PATH;
    delete process.env.BOUNTY_AUDIT_STORE_PATH;
    for (const f of [storeFile, storeFile?.replace(/\.json$/i, '.audit.json')]) {
      try {
        if (f && fs.existsSync(f)) {
          fs.unlinkSync(f);
        }
      } catch {}
    }
  });

  async function loadFreshStore() {
    vi.resetModules();
    const traceMod = await import('../src/services/stateUpdateTrace');
    traceMod.setGlobalStateUpdateTraceSink((rec) => capturedTraces.push(rec));
    return import('../src/services/bountyStore');
  }

  it('records pending, committed, and failed traces with redacted refs when competing workers race', async () => {
    const store = await loadFreshStore();

    // Create open bounty
    const bounty = await store.createBounty({
      repo: 'stellar/bounty-app',
      issueNumber: 99,
      title: 'Obs trace test',
      summary: 'Trace concurrent outcomes',
      maintainer: MAINTAINER,
      tokenSymbol: 'XLM',
      amount: 100,
      deadlineDays: 7,
      labels: ['tracing'],
    });

    expect(bounty.version).toBe(1);
    capturedTraces.length = 0; // reset trace buffer to isolate race condition

    // Worker 1 reserves at version 1; Worker 2 refunds at version 1
    const [w1, w2] = await Promise.allSettled([
      store.reserveBounty(bounty.id, CONTRIBUTOR, 1, {
        workerId: 'worker-1',
        eventRef: 'worker-1-event',
        deliveryRef: 'delivery-uuid-w1',
      }),
      store.refundBounty(bounty.id, MAINTAINER, undefined, 1, {
        workerId: 'worker-2',
        eventRef: 'worker-2-event',
        deliveryRef: 'delivery-uuid-w2',
      }),
    ]);

    // Exactly one winner and one loser
    const winner = [w1, w2].find((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
    const loser = [w1, w2].find((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(winner).toBeDefined();
    expect(loser).toBeDefined();

    // Inspect the captured trace records
    const pendingTraces = capturedTraces.filter((t) => t.outcome === 'pending');
    const committedTraces = capturedTraces.filter((t) => t.outcome === 'committed');
    const failedTraces = capturedTraces.filter((t) => t.outcome === 'failed');

    // Both workers emitted pending records before serialization
    expect(pendingTraces).toHaveLength(2);
    expect(pendingTraces.map((t) => t.workerId).sort()).toEqual(['worker-1', 'worker-2']);
    for (const pending of pendingTraces) {
      expect(pending.eventRef).toMatch(/^sha256:[0-9a-f]{16}$/);
      expect(pending.deliveryRef).toMatch(/^sha256:[0-9a-f]{16}$/);
    }

    // Exactly one worker committed
    expect(committedTraces).toHaveLength(1);
    expect(committedTraces[0].currentVersion).toBe(2);

    // The losing worker failed with BOUNTY_VERSION_CONFLICT
    expect(failedTraces).toHaveLength(1);
    expect(failedTraces[0].error).toBe('BOUNTY_VERSION_CONFLICT');
    expect(failedTraces[0].expectedVersion).toBe(1);
    expect(failedTraces[0].currentVersion).toBe(2);

    // Operators can distinguish pending from committed by matching eventRef
    const winnerEventRef = redactReference(
      committedTraces[0].workerId === 'worker-1' ? 'worker-1-event' : 'worker-2-event'
    );
    const loserEventRef = redactReference(
      failedTraces[0].workerId === 'worker-1' ? 'worker-1-event' : 'worker-2-event'
    );

    expect(committedTraces[0].eventRef).toBe(winnerEventRef);
    expect(failedTraces[0].eventRef).toBe(loserEventRef);
  });

  it('allows operators to identify uncommitted work when a worker crashes mid-stream and replayed work fails', async () => {
    const store = await loadFreshStore();

    const bounty = await store.createBounty({
      repo: 'stellar/bounty-app',
      issueNumber: 100,
      title: 'Crash recovery trace test',
      summary: 'Trace crash and replay',
      maintainer: MAINTAINER,
      tokenSymbol: 'XLM',
      amount: 150,
      deadlineDays: 7,
      labels: ['obs'],
    });

    capturedTraces.length = 0;

    // Worker 1 commits refund at version 1
    const refund = await store.refundBounty(bounty.id, MAINTAINER, undefined, 1, {
      workerId: 'worker-1',
      eventRef: 'refund-event-001',
    });
    expect(refund.version).toBe(2);

    // Worker 2 claimed a reservation at version 1, emitted pending, but crashed before execution
    const traceMod = await import('../src/services/stateUpdateTrace');
    const worker2Emitter = traceMod.createStateUpdateTrace((r) => capturedTraces.push(r));
    const worker2EventRef = redactReference('reserve-attempt-w2')!;
    worker2Emitter.pending({
      bountyId: bounty.id,
      transition: 'reserve',
      eventRef: worker2EventRef,
      expectedVersion: 1,
      actor: CONTRIBUTOR,
      workerId: 'worker-2-crashed',
    });

    // Verify trace logs before restart:
    // Worker 1 has pending + committed; Worker 2 has only pending!
    const w1Committed = capturedTraces.find(
      (t) => t.workerId === 'worker-1' && t.outcome === 'committed'
    );
    const w2Committed = capturedTraces.find(
      (t) => t.workerId === 'worker-2-crashed' && t.outcome === 'committed'
    );

    expect(w1Committed).toBeDefined();
    expect(w2Committed).toBeUndefined(); // Worker 2 never committed!

    // Process restarts
    const restartedStore = await loadFreshStore();

    // Worker 2 replays its reservation at the stale version 1
    await expect(
      restartedStore.reserveBounty(bounty.id, CONTRIBUTOR, 1, {
        workerId: 'worker-2-replayed',
        eventRef: worker2EventRef,
      })
    ).rejects.toMatchObject({
      code: 'BOUNTY_VERSION_CONFLICT',
      currentVersion: 2,
    });

    // Trace shows: Worker 2 emitted pending, then failed with BOUNTY_VERSION_CONFLICT
    const replayedFailed = capturedTraces.find(
      (t) => t.workerId === 'worker-2-replayed' && t.outcome === 'failed'
    );
    expect(replayedFailed).toBeDefined();
    expect(replayedFailed!.eventRef).toBe(worker2EventRef);
    expect(replayedFailed!.currentVersion).toBe(2);
    expect(replayedFailed!.expectedVersion).toBe(1);
  });

  it('traces reservation expiration worker lifecycle transitions', async () => {
    const store = await loadFreshStore();
    const now = Math.floor(Date.now() / 1000);

    const staleBounty = {
      id: 'BNT-EXP-TRACE-01',
      repo: 'stellar/bounty-app',
      issueNumber: 101,
      title: 'Stale reservation trace',
      summary: 'Observing expiry worker',
      maintainer: MAINTAINER,
      contributor: CONTRIBUTOR,
      tokenSymbol: 'XLM',
      tokenAddress: 'CAS3J7YBBURBV347V3UAEAOAT2IZU7QHWG7YWCOOOFLBEBGKND655DHA',
      amount: 100,
      labels: [],
      status: 'reserved' as const,
      createdAt: now - 10 * 86400,
      deadlineAt: now + 999999,
      reservedAt: now - 9 * 86400,
      version: 1,
      events: [
        { type: 'created' as const, timestamp: now - 10 * 86400 },
        { type: 'reserved' as const, timestamp: now - 9 * 86400, actor: CONTRIBUTOR },
      ],
      reservationTimeoutSeconds: 86400,
    };

    fs.writeFileSync(storeFile, JSON.stringify([staleBounty], null, 2));
    capturedTraces.length = 0;

    const result = await store.expireStaleReservations(7 * 86400, {
      workerId: 'expiry-worker-1',
      cursorRef: 'cursor-checkpoint-1',
    });

    expect(result.expiredBountyIds).toContain(staleBounty.id);

    const pending = capturedTraces.find(
      (t) => t.bountyId === staleBounty.id && t.outcome === 'pending' && t.transition === 'expire'
    );
    const committed = capturedTraces.find(
      (t) => t.bountyId === staleBounty.id && t.outcome === 'committed' && t.transition === 'expire'
    );

    expect(pending).toBeDefined();
    expect(committed).toBeDefined();
    expect(pending!.cursorRef).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(committed!.cursorRef).toBe(pending!.cursorRef);
    expect(committed!.currentVersion).toBe(2);
    expect(committed!.toStatus).toBe('open');
  });
});

describe('GitHub webhook processing outcome tracing (#1943)', () => {
  let capturedTraces: StateUpdateTraceRecord[] = [];
  let storeFile: string;
  let dedupFile: string;

  beforeEach(() => {
    storeFile = path.join(os.tmpdir(), `webhook-trace-bounties-${randomUUID()}.json`);
    dedupFile = path.join(os.tmpdir(), `webhook-trace-dedup-${randomUUID()}.json`);
    fs.writeFileSync(storeFile, '[]', 'utf8');
    fs.writeFileSync(dedupFile, JSON.stringify({ version: 1, deliveries: {} }), 'utf8');

    process.env.BOUNTY_STORE_PATH = storeFile;
    process.env.BOUNTY_AUDIT_STORE_PATH = storeFile.replace(/\.json$/i, '.audit.json');
    process.env.WEBHOOK_DELIVERY_STORE_PATH = dedupFile;
    process.env.STORE_LOCK_TIMEOUT_MS = '5000';

    capturedTraces = [];
    setGlobalStateUpdateTraceSink((rec) => capturedTraces.push(rec));
  });

  afterEach(() => {
    setGlobalStateUpdateTraceSink(null);
    delete process.env.BOUNTY_STORE_PATH;
    delete process.env.BOUNTY_AUDIT_STORE_PATH;
    delete process.env.WEBHOOK_DELIVERY_STORE_PATH;
    for (const f of [storeFile, storeFile?.replace(/\.json$/i, '.audit.json'), dedupFile]) {
      try {
        if (f && fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
  });

  it('records a redacted failed trace on invalid HMAC signature without leaking tokens', () => {
    const rawDelivery = 'deliv-raw-secret-123456';
    const rawSignature = 'sha256=invalid-signature-hex-value-999';

    const record = traceWebhookOutcome({
      outcome: 'failed',
      deliveryRef: rawDelivery,
      eventRef: rawSignature,
      error: 'invalid_hmac_signature',
      reason: 'Invalid GitHub webhook signature.',
    });

    expect(record.outcome).toBe('failed');
    expect(record.transition).toBe('webhook_signature_verify');
    expect(record.deliveryRef).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(record.eventRef).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(record.error).toBe('invalid_hmac_signature');

    // Never leak raw tokens
    const json = JSON.stringify(record);
    expect(json).not.toContain(rawDelivery);
    expect(json).not.toContain(rawSignature);
  });

  it('records a pending trace for an out-of-order close event', async () => {
    vi.resetModules();
    const traceMod = await import('../src/services/stateUpdateTrace');
    traceMod.setGlobalStateUpdateTraceSink((rec) => capturedTraces.push(rec));
    const { handleGitHubPrEvent } = await import('../src/webhooks/githubPrHandler');

    const prUrl = 'https://github.com/owner/repo/pull/777';
    const rawDeliveryId = 'github-delivery-out-of-order-001';

    // Event arrives before any bounty references this PR URL
    const result = await handleGitHubPrEvent(
      {
        action: 'closed',
        pull_request: { html_url: prUrl, merged: true },
      },
      rawDeliveryId
    );

    expect(result.deferred).toBe(true);
    expect(result.reason).toBe('no_matching_bounty');

    const pendingTrace = capturedTraces.find(
      (t) => t.outcome === 'pending' && t.reason === 'out_of_order_close_event'
    );
    expect(pendingTrace).toBeDefined();
    expect(pendingTrace!.deliveryRef).toBe(redactReference(rawDeliveryId));
    expect(pendingTrace!.bountyId).toBe('unmatched');
    expect(pendingTrace!.transition).toBe('pr_merged');
  });

  it('allows operators to distinguish a pending event from a committed transition', async () => {
    vi.resetModules();
    const traceMod = await import('../src/services/stateUpdateTrace');
    traceMod.setGlobalStateUpdateTraceSink((rec) => capturedTraces.push(rec));
    const store = await import('../src/services/bountyStore');
    const { handleGitHubPrEvent } = await import('../src/webhooks/githubPrHandler');

    const prUrl = 'https://github.com/owner/repo/pull/888';
    const rawDeliveryId = 'github-delivery-distinguish-002';
    const expectedDeliveryRef = redactReference(rawDeliveryId);

    // Step 1: Out-of-order close event arrives
    const step1Result = await handleGitHubPrEvent(
      {
        action: 'closed',
        pull_request: { html_url: prUrl, merged: true },
      },
      rawDeliveryId
    );
    expect(step1Result.deferred).toBe(true);

    // Operator inspects traces at Step 1: Exactly one pending trace exists for this deliveryRef
    const tracesForDeliveryStep1 = capturedTraces.filter((t) => t.deliveryRef === expectedDeliveryRef);
    expect(tracesForDeliveryStep1).toHaveLength(1);
    expect(tracesForDeliveryStep1[0].outcome).toBe('pending');
    expect(tracesForDeliveryStep1[0].reason).toBe('out_of_order_close_event');

    // Step 2: Bounty is created and solution is submitted with this PR URL
    const bounty = await store.createBounty({
      repo: 'owner/repo',
      issueNumber: 888,
      title: 'Distinguish pending vs committed',
      summary: 'Observability verification',
      maintainer: MAINTAINER,
      tokenSymbol: 'XLM',
      amount: 200,
      deadlineDays: 7,
      labels: ['obs'],
    });
    await store.reserveBounty(bounty.id, CONTRIBUTOR);
    await store.submitBounty(bounty.id, CONTRIBUTOR, prUrl);

    // Clear trace log buffer to isolate Step 3 commits
    capturedTraces.length = 0;

    // Step 3: Webhook delivery is replayed / resumed with the same deliveryId
    const step3Result = await handleGitHubPrEvent(
      {
        action: 'closed',
        pull_request: { html_url: prUrl, merged: true },
      },
      rawDeliveryId
    );
    expect(step3Result.deferred).toBeUndefined();
    expect(step3Result.duplicate).toBe(false);

    // Operator inspects traces at Step 3:
    // Transitions have outcome 'committed' and match the exact same deliveryRef!
    const tracesForDeliveryStep3 = capturedTraces.filter((t) => t.deliveryRef === expectedDeliveryRef);
    const committedPrMerged = tracesForDeliveryStep3.find(
      (t) => t.outcome === 'committed' && t.transition === 'pr_merged'
    );
    const committedRelease = tracesForDeliveryStep3.find(
      (t) => t.outcome === 'committed' && t.transition === 'release'
    );

    expect(committedPrMerged).toBeDefined();
    expect(committedPrMerged!.bountyId).toBe(bounty.id);
    expect(committedRelease).toBeDefined();
    expect(committedRelease!.bountyId).toBe(bounty.id);
    expect(committedRelease!.currentVersion).toBe(5); // create(1) -> reserve(2) -> submit(3) -> pr_merged(4) -> release(5)

    // Operator can correlate the sequence:
    // deliveryRef 'sha256:...' was 'pending' before submission, and transitioned to 'committed' after submission
    expect(committedPrMerged!.deliveryRef).toBe(expectedDeliveryRef);
    expect(committedRelease!.deliveryRef).toBe(expectedDeliveryRef);
  });
});
