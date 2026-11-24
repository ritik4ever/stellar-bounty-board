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
  redactBackfillRef,
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

describe('Soroban indexer cursor replay and failure (#1934)', () => {
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soroban-cursor-replay-'));
    indexFile = path.join(directory, 'indexed-events.json');
    cursorFile = path.join(directory, 'indexed-events.cursor.json');
    post.mockReset();
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('applies two same-ledger events once in order across restart between event write and cursor persistence', async () => {
    // Poll 1: establish committed checkpoint at ledger 99
    post.mockResolvedValueOnce(
      rpcResult([{ id: 'ledger-99-evt-1', ledger: 99, event_index: 0 } as { id: string }], 'cursor-99'),
    );
    await poll();
    expect(readCursor()).toBe('cursor-99');

    // Simulate worker crash/restart after writing ledger 100's two events to indexFile,
    // BEFORE cursorFile was updated (cursorFile still holds cursor-99).
    const preCrashEvents = readEvents();
    preCrashEvents.push(
      { id: 'ledger-100-evt-1', ledger: 100, event_index: 0 },
      { id: 'ledger-100-evt-2', ledger: 100, event_index: 1 },
    );
    fs.writeFileSync(indexFile, JSON.stringify(preCrashEvents, null, 2));
    expect(readCursor()).toBe('cursor-99');

    // Restart: RPC replays ledger 100's two events from cursor-99, followed by ledger 101
    post.mockResolvedValueOnce(
      rpcResult(
        [
          { id: 'ledger-100-evt-1', ledger: 100, event_index: 0 } as { id: string },
          { id: 'ledger-100-evt-2', ledger: 100, event_index: 1 } as { id: string },
          { id: 'ledger-101-evt-1', ledger: 101, event_index: 0 } as { id: string },
        ],
        'cursor-101',
      ),
    );
    await poll();

    expect(post.mock.calls[1][1].params.pagination).toEqual({ cursor: 'cursor-99', limit: 100 });
    expect(readEvents().map((e: { id: string }) => e.id)).toEqual([
      'ledger-99-evt-1',
      'ledger-100-evt-1',
      'ledger-100-evt-2',
      'ledger-101-evt-1',
    ]);
    expect(readCursor()).toBe('cursor-101');
  });

  it('recovers when cursorFile is missing or corrupt after two same-ledger events were written', async () => {
    // Two events from ledger 100 persisted, cursorFile missing (crash before first cursor write)
    fs.writeFileSync(
      indexFile,
      JSON.stringify(
        [
          { id: 'evt-100-a', ledger: 100, event_index: 0 },
          { id: 'evt-100-b', ledger: 100, event_index: 1 },
        ],
        null,
        2,
      ),
    );

    // Restarted poll resumes from fallback evt-100-b and receives replay + new event
    post.mockResolvedValueOnce(
      rpcResult(
        [
          { id: 'evt-100-a', ledger: 100, event_index: 0 } as { id: string },
          { id: 'evt-100-b', ledger: 100, event_index: 1 } as { id: string },
          { id: 'evt-100-c', ledger: 100, event_index: 2 } as { id: string },
        ],
        'cursor-100-healed',
      ),
    );
    await poll();

    expect(post.mock.calls[0][1].params.pagination).toEqual({ cursor: 'evt-100-b', limit: 100 });
    expect(readEvents().map((e: { id: string }) => e.id)).toEqual([
      'evt-100-a',
      'evt-100-b',
      'evt-100-c',
    ]);
    expect(readCursor()).toBe('cursor-100-healed');

    // Corrupt cursorFile + malformed RPC error response: leaves events & previous cursor intact
    fs.writeFileSync(cursorFile, '{not-valid-json');
    post.mockResolvedValueOnce({ data: { error: { message: 'RPC timeout' } } });
    await poll();
    expect(readEvents().map((e: { id: string }) => e.id)).toEqual([
      'evt-100-a',
      'evt-100-b',
      'evt-100-c',
    ]);

    // Subsequent poll heals corrupt cursorFile via fallback to evt-100-c
    post.mockResolvedValueOnce(
      rpcResult([{ id: 'evt-100-c', ledger: 100, event_index: 2 } as { id: string }], 'cursor-100-final'),
    );
    await poll();
    expect(readCursor()).toBe('cursor-100-final');
    expect(readEvents().map((e: { id: string }) => e.id)).toEqual([
      'evt-100-a',
      'evt-100-b',
      'evt-100-c',
    ]);
  });

  it('reproduces cursor write failure after event write and heals on retry without duplicating or leaving temp files (SBB-2026-462)', async () => {
    const cursorSubDir = path.join(directory, 'cursor-dir');
    fs.mkdirSync(cursorSubDir);
    const localCursorFile = path.join(cursorSubDir, 'indexed-events.cursor.json');
    const pollWithLocalCursor = () =>
      pollEvents({
        indexFile,
        cursorFile: localCursorFile,
        rpcUrl: 'https://rpc.example.test',
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        startLedger: 100,
        maxRetries: 1,
      });

    post.mockResolvedValueOnce(
      rpcResult([{ id: 'evt-1', ledger: 100, event_index: 0 } as { id: string }], 'cursor-100'),
    );
    await pollWithLocalCursor();
    expect(JSON.parse(fs.readFileSync(localCursorFile, 'utf8')).cursor).toBe('cursor-100');

    // Simulate failure right between indexFile commit and cursorFile commit
    // by making the cursor directory read-only while indexFile remains writable.
    fs.chmodSync(cursorSubDir, 0o555);
    post.mockResolvedValueOnce(
      rpcResult(
        [
          { id: 'evt-2', ledger: 101, event_index: 0 } as { id: string },
          { id: 'evt-3', ledger: 101, event_index: 1 } as { id: string },
        ],
        'cursor-101',
      ),
    );
    try {
      await pollWithLocalCursor();
    } finally {
      fs.chmodSync(cursorSubDir, 0o755);
    }

    // Events were committed, cursor remained at cursor-100, and no .tmp files leaked.
    expect(readEvents().map((e: { id: string }) => e.id)).toEqual(['evt-1', 'evt-2', 'evt-3']);
    expect(JSON.parse(fs.readFileSync(localCursorFile, 'utf8')).cursor).toBe('cursor-100');
    expect(fs.readdirSync(directory).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(fs.readdirSync(cursorSubDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);

    // Retry from cursor-100 replays ledger 101 + advances to ledger 102 without duplicating evt-2/evt-3.
    post.mockResolvedValueOnce(
      rpcResult(
        [
          { id: 'evt-2', ledger: 101, event_index: 0 } as { id: string },
          { id: 'evt-3', ledger: 101, event_index: 1 } as { id: string },
          { id: 'evt-4', ledger: 102, event_index: 0 } as { id: string },
        ],
        'cursor-102',
      ),
    );
    await pollWithLocalCursor();

    expect(post.mock.calls[2][1].params.pagination).toEqual({ cursor: 'cursor-100', limit: 100 });
    expect(readEvents().map((e: { id: string }) => e.id)).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
      'evt-4',
    ]);
    expect(JSON.parse(fs.readFileSync(localCursorFile, 'utf8')).cursor).toBe('cursor-102');
  });

  it('deduplicates replayed events without id by ledger and event_index across restart (SBB-2026-462)', async () => {
    post.mockResolvedValueOnce(
      rpcResult([{ id: 'evt-1', ledger: 100, event_index: 0 } as { id: string }], 'cursor-100'),
    );
    await poll();

    // Crash after writing an event that only carries ledger + event_index (no id) before cursorFile updates.
    const preCrash = readEvents();
    preCrash.push({ type: 'submit', ledger: 101, raw: { ledger: 101, event_index: 0 } });
    fs.writeFileSync(indexFile, JSON.stringify(preCrash, null, 2));

    post.mockResolvedValueOnce(
      rpcResult(
        [
          { ledger: 101, event_index: 0, type: 'submit' } as unknown as { id: string },
          { id: 'evt-101-1', ledger: 101, event_index: 1 } as { id: string },
        ],
        'cursor-101',
      ),
    );
    await poll();

    const stored = readEvents();
    expect(stored).toHaveLength(3);
    expect(stored[1].ledger).toBe(101);
    expect(stored[2].id).toBe('evt-101-1');
    expect(readCursor()).toBe('cursor-101');
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

  it('traces pending vs committed transitions with redacted event and cursor refs (#1938)', async () => {
    const store = createFileBackfillStore(backfillIndexFile, backfillCursorFile);
    const evt = createBountyEvent({ id: 'evt-trace-secret-id', ledger: 100, eventIndex: 0 });
    const rawCursor = 'sensitive-paging-cursor-xyz';
    const logs: string[] = [];
    const observed: Array<Record<string, unknown>> = [];

    const result = await runEventBackfill({
      token: OPERATOR_TOKEN,
      request: { startLedger: 100, endLedger: 100, cursor: rawCursor },
      env: testEnv,
      fetchPage: async () => rpcPage([evt], 100),
      store,
      logger: {
        log: (msg: string) => logs.push(msg),
        error: () => {},
      },
      onTrace: (trace: Record<string, unknown>) => observed.push(trace),
    });

    expect(result.traces).toHaveLength(2);
    expect(observed).toHaveLength(2);

    // Operators can distinguish pending (before merge/commit) from committed transition
    expect(observed[0]).toMatchObject({
      phase: 'backfill_page',
      status: 'pending',
      reason: 'page_fetched',
      page: 1,
      eventCount: 1,
      cursorRef: redactBackfillRef(rawCursor),
      eventRefs: [redactBackfillRef('id:evt-trace-secret-id')],
    });
    expect(observed[1]).toMatchObject({
      phase: 'backfill_page',
      status: 'committed',
      reason: 'page_committed',
      page: 1,
      eventsAdded: 1,
      eventsSkipped: 0,
      cursorRef: redactBackfillRef(rawCursor),
      committedCursor: { ledger: 100, eventIndex: 0 },
    });

    // Raw cursor, raw event ID, and operator token must never appear in trace logs
    const joinedLogs = logs.join('\n');
    expect(joinedLogs).toContain('[BackfillTrace]');
    expect(joinedLogs).not.toContain(rawCursor);
    expect(joinedLogs).not.toContain('evt-trace-secret-id');
    expect(joinedLogs).not.toContain(OPERATOR_TOKEN);
  });

  it('records a failed trace with redacted cursor reference on missing RPC page (#1938)', async () => {
    const store = createFileBackfillStore(backfillIndexFile, backfillCursorFile);
    store.saveCursor({ ledger: 99, eventIndex: 2 });

    const rawCursor = 'missing-page-cursor-secret';
    const errorLogs: string[] = [];
    const observed: Array<Record<string, unknown>> = [];

    await expect(
      runEventBackfill({
        token: OPERATOR_TOKEN,
        request: { startLedger: 100, endLedger: 102, cursor: rawCursor },
        env: testEnv,
        fetchPage: async () => ({ result: { latestLedger: 102 } }), // missing events array
        store,
        logger: {
          log: () => {},
          error: (msg: string) => errorLogs.push(msg),
        },
        onTrace: (trace: Record<string, unknown>) => observed.push(trace),
      }),
    ).rejects.toMatchObject({ code: 'missing_rpc_page' });

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      phase: 'backfill_page',
      status: 'failed',
      reason: 'missing_rpc_page',
      errorCode: 'missing_rpc_page',
      cursorRef: redactBackfillRef(rawCursor),
      storedCursor: { ledger: 99, eventIndex: 2 },
    });
    expect(observed.some((t) => t.status === 'committed')).toBe(false);
    expect(errorLogs.join('\n')).not.toContain(rawCursor);
    expect(errorLogs.join('\n')).not.toContain(OPERATOR_TOKEN);
  });

  it('traces whole-ledger retry as pending then committed deduplicated transition (#1938)', async () => {
    const store = createFileBackfillStore(backfillIndexFile, backfillCursorFile);
    const evt1 = createBountyEvent({ id: 'evt-retry-1', ledger: 100, eventIndex: 0 });
    const evt2 = reserveBountyEvent({ id: 'evt-retry-2', ledger: 100, eventIndex: 1 });

    // First run commits ledger 100
    await runEventBackfill({
      token: OPERATOR_TOKEN,
      request: { startLedger: 100, endLedger: 100 },
      env: testEnv,
      fetchPage: async () => rpcPage([evt1, evt2], 100),
      store,
      logger: { log: () => {}, error: () => {} },
    });

    // Retry whole ledger 100 with a stored cursor at ledger 100
    const retryTraces: Array<Record<string, unknown>> = [];
    const retryResult = await runEventBackfill({
      token: OPERATOR_TOKEN,
      request: { startLedger: 100, endLedger: 100, cursor: 'retry-cursor-abc' },
      env: testEnv,
      fetchPage: async () => rpcPage([evt1, evt2], 100),
      store,
      logger: { log: () => {}, error: () => {} },
      onTrace: (trace: Record<string, unknown>) => retryTraces.push(trace),
    });

    expect(retryResult.eventsProcessed).toBe(0);
    expect(retryResult.eventsSkipped).toBe(2);
    expect(retryTraces[0]).toMatchObject({
      phase: 'backfill_page',
      status: 'pending',
      reason: 'whole_ledger_retry',
      cursorRef: redactBackfillRef('retry-cursor-abc'),
      storedCursor: { ledger: 100, eventIndex: 1 },
    });
    expect(retryTraces[1]).toMatchObject({
      phase: 'backfill_page',
      status: 'pending',
      reason: 'page_fetched',
    });
    expect(retryTraces[2]).toMatchObject({
      phase: 'backfill_page',
      status: 'committed',
      reason: 'whole_ledger_retry_deduped',
      eventsAdded: 0,
      eventsSkipped: 2,
    });
  });
});
