import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  createFileBackfillStore,
  runEventBackfill,
  BackfillError,
  backfillEventKey,
  // @ts-expect-error — plain JS worker module
} from '../worker/eventBackfill.js';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

import { pollEvents } from '../worker/indexer.js';

const post = vi.mocked(axios.post);

let directory: string;
let indexFile: string;
let cursorFile: string;

function readEvents() {
  return JSON.parse(fs.readFileSync(indexFile, 'utf8'));
}

function readCursor() {
  return JSON.parse(fs.readFileSync(cursorFile, 'utf8')).cursor;
}

function rpcResult(events: Array<{ id: string }>, cursor: string) {
  return { data: { result: { events, cursor } } };
}

function poll() {
  return pollEvents({
    indexFile,
    cursorFile,
    rpcUrl: 'https://rpc.example.test',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    startLedger: 100,
    maxRetries: 1,
  });
}

describe('Soroban indexer backfill checkpoints', () => {
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soroban-indexer-'));
    indexFile = path.join(directory, 'indexed-events.json');
    cursorFile = path.join(directory, 'indexed-events.cursor.json');
    post.mockReset();
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('resumes from the stored cursor and does not duplicate events from an overlapping page', async () => {
    post
      .mockResolvedValueOnce(rpcResult([{ id: 'event-a' }, { id: 'event-b' }], 'cursor-2'))
      .mockResolvedValueOnce(rpcResult([{ id: 'event-b' }, { id: 'event-c' }], 'cursor-3'));

    await poll();
    await poll();

    expect(readEvents().map((event: { id: string }) => event.id)).toEqual([
      'event-a',
      'event-b',
      'event-c',
    ]);
    expect(readCursor()).toBe('cursor-3');

    const firstParams = post.mock.calls[0][1].params;
    const secondParams = post.mock.calls[1][1].params;
    expect(firstParams.startLedger).toBe(100);
    expect(firstParams.pagination).toBeUndefined();
    expect(secondParams.startLedger).toBeUndefined();
    expect(secondParams.pagination).toEqual({ cursor: 'cursor-2', limit: 100 });
  });

  it('keeps the last committed cursor when the next RPC page is missing', async () => {
    post
      .mockResolvedValueOnce(rpcResult([{ id: 'event-a' }], 'cursor-2'))
      .mockRejectedValueOnce(new Error('RPC unavailable'))
      .mockResolvedValueOnce(rpcResult([{ id: 'event-b' }], 'cursor-3'));

    await poll();
    await poll();
    expect(readCursor()).toBe('cursor-2');
    expect(readEvents().map((event: { id: string }) => event.id)).toEqual(['event-a']);

    await poll();
    expect(readCursor()).toBe('cursor-3');
    expect(readEvents().map((event: { id: string }) => event.id)).toEqual([
      'event-a',
      'event-b',
    ]);
    expect(post.mock.calls[2][1].params.pagination).toEqual({ cursor: 'cursor-2', limit: 100 });
  });

  it('indexes multiple events in the same ledger in order and records their ledger sequence', async () => {
    post.mockResolvedValueOnce(
      rpcResult(
        [
          { id: 'ledger-100-event-1', ledger: 100 },
          { id: 'ledger-100-event-2', ledger: 100 },
        ],
        'cursor-ledger-100-final'
      )
    );

    await poll();

    const events = readEvents();
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe('ledger-100-event-1');
    expect(events[0].ledger).toBe(100);
    expect(events[1].id).toBe('ledger-100-event-2');
    expect(events[1].ledger).toBe(100);
    expect(readCursor()).toBe('cursor-ledger-100-final');
  });

  it('handles events in the same ledger spanning pages without skipping or duplicating', async () => {
    post
      .mockResolvedValueOnce(
        rpcResult([{ id: 'ledger-200-event-1', ledger: 200 }], 'cursor-ledger-200-part-1')
      )
      .mockResolvedValueOnce(
        rpcResult(
          [
            { id: 'ledger-200-event-1', ledger: 200 },
            { id: 'ledger-200-event-2', ledger: 200 },
          ],
          'cursor-ledger-200-part-2'
        )
      );

    await poll();
    await poll();

    const events = readEvents();
    expect(events.map((event: { id: string }) => event.id)).toEqual([
      'ledger-200-event-1',
      'ledger-200-event-2',
    ]);
    expect(events.map((event: { ledger?: number }) => event.ledger)).toEqual([200, 200]);
    expect(readCursor()).toBe('cursor-ledger-200-part-2');
  });
});

describe('Soroban event backfill replay, overlapping live polling, and failure isolation (#1939)', () => {
  let backfillDir: string;
  let backfillIndexFile: string;
  let backfillCursorFile: string;

  const CONTRACT_ID = 'CBACKFILLCONTRACT12345678901234567890123456789012345678';
  const OPERATOR_TOKEN = 'operator-test-token';
  const maintainerKey = Keypair.random().publicKey();
  const contributorKey = Keypair.random().publicKey();

  function scvSymbol(name: string): string {
    return xdr.ScVal.scvSymbol(name).toXDR('base64');
  }

  function createBountyEvent(options: {
    id: string;
    ledger: number;
    eventIndex?: number;
    bountyId?: number;
  }) {
    const value = nativeToScVal(
      {
        bounty_id: BigInt(options.bountyId ?? 1),
        maintainer: maintainerKey,
        amount: 5000000n,
      },
      {
        type: {
          bounty_id: ['symbol', 'u64'],
          maintainer: ['symbol', 'address'],
          amount: ['symbol', 'i128'],
        },
      }
    ).toXDR('base64');
    return {
      type: 'contract',
      contract_id: CONTRACT_ID,
      id: options.id,
      ledger: options.ledger,
      event_index: options.eventIndex ?? 0,
      topic: [scvSymbol('Bounty'), scvSymbol('Create')],
      value,
      ledger_closed_at: '2026-11-24T00:00:00Z',
    };
  }

  function reserveBountyEvent(options: {
    id: string;
    ledger: number;
    eventIndex?: number;
    bountyId?: number;
  }) {
    const value = nativeToScVal(
      {
        bounty_id: BigInt(options.bountyId ?? 1),
        contributor: contributorKey,
      },
      {
        type: {
          bounty_id: ['symbol', 'u64'],
          contributor: ['symbol', 'address'],
        },
      }
    ).toXDR('base64');
    return {
      type: 'contract',
      contract_id: CONTRACT_ID,
      id: options.id,
      ledger: options.ledger,
      event_index: options.eventIndex ?? 1,
      topic: [scvSymbol('Bounty'), scvSymbol('Reserv')],
      value,
      ledger_closed_at: '2026-11-24T00:00:00Z',
    };
  }

  function submitBountyEvent(options: {
    id: string;
    ledger: number;
    eventIndex?: number;
    bountyId?: number;
  }) {
    const value = nativeToScVal(
      {
        bounty_id: BigInt(options.bountyId ?? 1),
        contributor: contributorKey,
      },
      {
        type: {
          bounty_id: ['symbol', 'u64'],
          contributor: ['symbol', 'address'],
        },
      }
    ).toXDR('base64');
    return {
      type: 'contract',
      contract_id: CONTRACT_ID,
      id: options.id,
      ledger: options.ledger,
      event_index: options.eventIndex ?? 2,
      topic: [scvSymbol('Bounty'), scvSymbol('Submit')],
      value,
      ledger_closed_at: '2026-11-24T00:00:00Z',
    };
  }

  function releaseBountyEvent(options: {
    id: string;
    ledger: number;
    eventIndex?: number;
    bountyId?: number;
  }) {
    const value = nativeToScVal(
      {
        bounty_id: BigInt(options.bountyId ?? 1),
        contributor: contributorKey,
        maintainer: maintainerKey,
        amount: 5000000n,
      },
      {
        type: {
          bounty_id: ['symbol', 'u64'],
          contributor: ['symbol', 'address'],
          maintainer: ['symbol', 'address'],
          amount: ['symbol', 'i128'],
        },
      }
    ).toXDR('base64');
    return {
      type: 'contract',
      contract_id: CONTRACT_ID,
      id: options.id,
      ledger: options.ledger,
      event_index: options.eventIndex ?? 3,
      topic: [scvSymbol('Bounty'), scvSymbol('Releas')],
      value,
      ledger_closed_at: '2026-11-24T00:00:00Z',
    };
  }

  function rpcPage(events: unknown[], latestLedger: number, cursor?: string) {
    return {
      jsonrpc: '2.0',
      id: 1,
      result: {
        latestLedger,
        events,
        ...(cursor ? { cursor } : {}),
      },
    };
  }

  const testEnv = {
    SOROBAN_BACKFILL_TOKEN: OPERATOR_TOKEN,
    SOROBAN_CONTRACT_ID: CONTRACT_ID,
  } as NodeJS.ProcessEnv;

  beforeEach(() => {
    backfillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soroban-backfill-lifecycle-'));
    backfillIndexFile = path.join(backfillDir, 'indexed-events.json');
    backfillCursorFile = `${backfillIndexFile}.backfill-cursor.json`;
  });

  afterEach(() => {
    fs.rmSync(backfillDir, { recursive: true, force: true });
  });

  it('backfill overlapping live polling preserves complete events without duplicate lifecycle transitions', async () => {
    const store = createFileBackfillStore(backfillIndexFile, backfillCursorFile);

    // 1. Live polling polled ledger 100 and indexed `created` and `reserve` transitions
    const evtCreated = createBountyEvent({ id: 'evt-bounty-created', ledger: 100, eventIndex: 0 });
    const evtReserved = reserveBountyEvent({ id: 'evt-bounty-reserved', ledger: 100, eventIndex: 1 });

    post.mockResolvedValueOnce({
      data: {
        result: {
          events: [evtCreated, evtReserved],
          cursor: 'cursor-live-100',
        },
      },
    });

    await pollEvents({
      indexFile: backfillIndexFile,
      cursorFile: path.join(backfillDir, 'indexed-events.cursor.json'),
      rpcUrl: 'https://rpc.example.test',
      contractId: CONTRACT_ID,
      startLedger: 100,
      maxRetries: 1,
    });

    const initialEvents = JSON.parse(fs.readFileSync(backfillIndexFile, 'utf8'));
    expect(initialEvents).toHaveLength(2);
    expect(initialEvents.map((e: { type: string }) => e.type)).toEqual(['create', 'reserve']);

    // 2. Operator runs a backfill for ledgers 100-101.
    // The RPC response for ledger 100 contains created, reserved, AND submit.
    // Ledger 101 contains release.
    const evtSubmitted = submitBountyEvent({ id: 'evt-bounty-submitted', ledger: 100, eventIndex: 2 });
    const evtReleased = releaseBountyEvent({ id: 'evt-bounty-released', ledger: 101, eventIndex: 0 });

    const fetchPage = vi.fn(async ({ startLedger }: { startLedger: number }) => {
      if (startLedger === 100) {
        return rpcPage([evtCreated, evtReserved, evtSubmitted], 101);
      }
      return rpcPage([evtReleased], 101);
    });

    const result = await runEventBackfill({
      token: OPERATOR_TOKEN,
      request: { startLedger: 100, endLedger: 101 },
      env: testEnv,
      fetchPage,
      store,
      logger: { log: () => {}, error: () => {} },
    });

    // 2 events added (submit, release), 2 events skipped (created, reserved)
    expect(result.eventsProcessed).toBe(2);
    expect(result.eventsSkipped).toBe(2);
    expect(result.status).toBe('committed');

    const finalEvents = JSON.parse(fs.readFileSync(backfillIndexFile, 'utf8'));
    expect(finalEvents).toHaveLength(4);

    // Verify all 4 lifecycle transitions are recorded in strict sequence
    expect(finalEvents.map((e: { type: string }) => e.type)).toEqual([
      'create',
      'reserve',
      'submit',
      'release',
    ]);

    // Verify properties of transitions
    expect(finalEvents[0].actor).toBe(maintainerKey);
    expect(finalEvents[1].contributor).toBe(contributorKey);
    expect(finalEvents[2].contributor).toBe(contributorKey);
    expect(finalEvents[3].released).toBe(true);
    expect(finalEvents[3].maintainer).toBe(maintainerKey);
    expect(finalEvents[3].contributor).toBe(contributorKey);

    // Verify deduplication keys
    const keys = finalEvents.map(backfillEventKey);
    expect(new Set(keys).size).toBe(4);
  });

  it('recovers from a missing RPC page during backfill and replays whole ledger without duplicate lifecycle transitions', async () => {
    const store = createFileBackfillStore(backfillIndexFile, backfillCursorFile);

    const evtCreated = createBountyEvent({ id: 'evt-100-create', ledger: 100, eventIndex: 0 });
    const evtReserved = reserveBountyEvent({ id: 'evt-100-reserve', ledger: 100, eventIndex: 1 });
    const evtSubmitted = submitBountyEvent({ id: 'evt-101-submit', ledger: 101, eventIndex: 0 });
    const evtReleased = releaseBountyEvent({ id: 'evt-101-release', ledger: 101, eventIndex: 1 });

    // Backfill attempt 1: ledger 100 succeeds; ledger 101 returns a missing events page
    let callCount = 0;
    const flakyFetchPage = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return rpcPage([evtCreated, evtReserved], 101);
      }
      // Missing events page: returns result without events array
      return { jsonrpc: '2.0', id: 1, result: { latestLedger: 101 } };
    });

    await expect(
      runEventBackfill({
        token: OPERATOR_TOKEN,
        request: { startLedger: 100, endLedger: 101 },
        env: testEnv,
        fetchPage: flakyFetchPage,
        store,
        logger: { log: () => {}, error: () => {} },
      })
    ).rejects.toMatchObject({ code: 'missing_rpc_page' });

    // State after failure: ledger 100 events were committed, cursor is at ledger 100
    const eventsAfterFailure = JSON.parse(fs.readFileSync(backfillIndexFile, 'utf8'));
    expect(eventsAfterFailure).toHaveLength(2);
    expect(eventsAfterFailure.map((e: { type: string }) => e.type)).toEqual(['create', 'reserve']);

    const cursorAfterFailure = JSON.parse(fs.readFileSync(backfillCursorFile, 'utf8'));
    expect(cursorAfterFailure).toEqual({ ledger: 100, eventIndex: 1 });

    // Replay/Retry of whole ledger range:
    // Simulating process restart by creating a new store instance from disk files
    const restartedStore = createFileBackfillStore(backfillIndexFile, backfillCursorFile);
    const retryFetchPage = vi.fn(async ({ startLedger }: { startLedger: number }) => {
      if (startLedger === 100) {
        return rpcPage([evtCreated, evtReserved], 101);
      }
      return rpcPage([evtSubmitted, evtReleased], 101);
    });

    const retryResult = await runEventBackfill({
      token: OPERATOR_TOKEN,
      request: { startLedger: 100, endLedger: 101 },
      env: testEnv,
      fetchPage: retryFetchPage,
      store: restartedStore,
      logger: { log: () => {}, error: () => {} },
    });

    expect(retryResult.status).toBe('committed');
    expect(retryResult.eventsProcessed).toBe(2); // submitted and released
    expect(retryResult.eventsSkipped).toBe(2); // created and reserved re-read from ledger 100

    const finalEvents = JSON.parse(fs.readFileSync(backfillIndexFile, 'utf8'));
    expect(finalEvents).toHaveLength(4);
    expect(finalEvents.map((e: { type: string }) => e.type)).toEqual([
      'create',
      'reserve',
      'submit',
      'release',
    ]);

    const finalCursor = JSON.parse(fs.readFileSync(backfillCursorFile, 'utf8'));
    expect(finalCursor).toEqual({ ledger: 101, eventIndex: 1 });
  });

  it('restarts and replays complete lifecycle range idempotently with zero duplicate transitions', async () => {
    const store = createFileBackfillStore(backfillIndexFile, backfillCursorFile);

    const evtCreated = createBountyEvent({ id: 'evt-full-create', ledger: 100, eventIndex: 0 });
    const evtReserved = reserveBountyEvent({ id: 'evt-full-reserve', ledger: 100, eventIndex: 1 });
    const evtSubmitted = submitBountyEvent({ id: 'evt-full-submit', ledger: 100, eventIndex: 2 });
    const evtReleased = releaseBountyEvent({ id: 'evt-full-release', ledger: 100, eventIndex: 3 });

    // Initial backfill pass
    await runEventBackfill({
      token: OPERATOR_TOKEN,
      request: { startLedger: 100, endLedger: 100 },
      env: testEnv,
      fetchPage: async () => rpcPage([evtCreated, evtReserved, evtSubmitted, evtReleased], 100),
      store,
      logger: { log: () => {}, error: () => {} },
    });

    expect(JSON.parse(fs.readFileSync(backfillIndexFile, 'utf8'))).toHaveLength(4);

    // Simulate complete process restart
    const restartedStore = createFileBackfillStore(backfillIndexFile, backfillCursorFile);

    // Replay identical backfill job
    const replayResult = await runEventBackfill({
      token: OPERATOR_TOKEN,
      request: { startLedger: 100, endLedger: 100 },
      env: testEnv,
      fetchPage: async () => rpcPage([evtCreated, evtReserved, evtSubmitted, evtReleased], 100),
      store: restartedStore,
      logger: { log: () => {}, error: () => {} },
    });

    expect(replayResult.eventsProcessed).toBe(0);
    expect(replayResult.eventsSkipped).toBe(4);

    const replayedEvents = JSON.parse(fs.readFileSync(backfillIndexFile, 'utf8'));
    expect(replayedEvents).toHaveLength(4);
    expect(replayedEvents.map((e: { type: string }) => e.type)).toEqual([
      'create',
      'reserve',
      'submit',
      'release',
    ]);
  });
});
