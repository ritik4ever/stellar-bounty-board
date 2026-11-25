import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
// @ts-expect-error — plain JS worker module, no type declarations
import { normalizeEvent } from '../worker/indexer.js';
import {
  BackfillError,
  MAX_LEDGER_RANGE,
  authenticateBackfill,
  backfillEventKey,
  clampEndLedger,
  createFileBackfillStore,
  runEventBackfill,
  validateBackfillRequest,
  validateRpcPage,
  // @ts-expect-error — plain JS worker module, no type declarations
} from '../worker/eventBackfill.js';

const CONTRACT = 'CBACKFILLCONTRACT';
const TOKEN = 'operator-token-value-123';

const maintainer = Keypair.random().publicKey();

function scvSymbol(name: string): string {
  return xdr.ScVal.scvSymbol(name).toXDR('base64');
}

function createEvent(options: {
  id: string;
  ledger: number;
  eventIndex?: number;
  amount?: bigint;
}) {
  const value = nativeToScVal(
    { bounty_id: BigInt(options.ledger), maintainer, amount: options.amount ?? 5n },
    {
      type: {
        bounty_id: ['symbol', 'u64'],
        maintainer: ['symbol', 'address'],
        amount: ['symbol', 'i128'],
      },
    },
  ).toXDR('base64');
  return {
    type: 'contract',
    contract_id: CONTRACT,
    id: options.id,
    ledger: options.ledger,
    event_index: options.eventIndex ?? 0,
    topic: [scvSymbol('Bounty'), scvSymbol('Create')],
    value,
    ledger_closed_at: '2026-11-24T00:00:00Z',
  };
}

function page(events: unknown[], latestLedger: number, pagingToken?: string) {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      latestLedger,
      events,
      ...(pagingToken ? { cursor: pagingToken } : {}),
    },
  };
}

function thrownCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

function env(token: string | undefined = TOKEN) {
  return {
    SOROBAN_BACKFILL_TOKEN: token,
    SOROBAN_CONTRACT_ID: CONTRACT,
  } as NodeJS.ProcessEnv;
}

let workDir: string;
let eventsFile: string;
let cursorFile: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounty-backfill-'));
  eventsFile = path.join(workDir, 'indexed-events.json');
  cursorFile = `${eventsFile}.backfill-cursor.json`;
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('backfill authentication (#1937)', () => {
  it('fails closed when the operator token is not configured', () => {
    expect(thrownCode(() => authenticateBackfill('anything', {}))).toBe('unauthorized');
    expect(() => authenticateBackfill('anything', { SOROBAN_BACKFILL_TOKEN: '' })).toThrow(
      /not configured/,
    );
  });

  it('rejects missing, empty and wrong tokens', () => {
    expect(() => authenticateBackfill(undefined, { SOROBAN_BACKFILL_TOKEN: TOKEN })).toThrow(
      /missing backfill operator token/,
    );
    expect(() => authenticateBackfill('', { SOROBAN_BACKFILL_TOKEN: TOKEN })).toThrow(
      /missing backfill operator token/,
    );
    expect(() => authenticateBackfill('wrong-token', { SOROBAN_BACKFILL_TOKEN: TOKEN })).toThrow(
      /invalid backfill operator token/,
    );
  });

  it('accepts the configured token and never echoes either token in errors', () => {
    expect(() => authenticateBackfill(TOKEN, { SOROBAN_BACKFILL_TOKEN: TOKEN })).not.toThrow();
    try {
      authenticateBackfill('attacker-supplied-secret', { SOROBAN_BACKFILL_TOKEN: TOKEN });
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(BackfillError);
      expect((err as Error).message).not.toContain(TOKEN);
      expect((err as Error).message).not.toContain('attacker-supplied-secret');
    }
  });
});

describe('backfill request validation (#1937)', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'backfill everything'],
    ['an empty object', {}],
    ['a missing endLedger', { startLedger: 10 }],
    ['a zero startLedger', { startLedger: 0, endLedger: 10 }],
    ['a fractional startLedger', { startLedger: 1.5, endLedger: 10 }],
    ['a string startLedger', { startLedger: '10', endLedger: 20 }],
    ['inverted bounds', { startLedger: 20, endLedger: 10 }],
    ['an oversized range', { startLedger: 1, endLedger: MAX_LEDGER_RANGE + 1 }],
  ])('rejects %s', (_label, input) => {
    expect(thrownCode(() => validateBackfillRequest(input))).toBe('invalid_request');
  });

  it('rejects fields an operator could use to redirect the job', () => {
    expect(() =>
      validateBackfillRequest({ startLedger: 1, endLedger: 2, rpcUrl: 'http://evil.example' }),
    ).toThrow(/unsupported backfill field: rpcUrl/);
    expect(() =>
      validateBackfillRequest({ startLedger: 1, endLedger: 2, contractId: 'COTHER' }),
    ).toThrow(/unsupported backfill field: contractId/);
    expect(() =>
      validateBackfillRequest({ startLedger: 1, endLedger: 2, events: [createEvent({ id: 'x', ledger: 1 })] }),
    ).toThrow(/unsupported backfill field: events/);
  });

  it.each([['a space', 'bad cursor'], ['an object', { $gt: '' }], ['an overlong token', 'a'.repeat(257)]])(
    'rejects a cursor that is %s',
    (_label, cursor) => {
      expect(() => validateBackfillRequest({ startLedger: 1, endLedger: 2, cursor })).toThrow(
        /cursor must be a short paging token/,
      );
    },
  );

  it('accepts and normalizes a valid bounded request', () => {
    expect(validateBackfillRequest({ startLedger: 10, endLedger: 20, cursor: 'abc_DEF-123==' })).toEqual(
      { startLedger: 10, endLedger: 20, cursor: 'abc_DEF-123==' },
    );
  });
});

describe('RPC page validation (#1937)', () => {
  it('treats a response without an events array as a missing page', () => {
    expect(thrownCode(() => validateRpcPage({ result: { latestLedger: 10 } }, CONTRACT))).toBe(
      'missing_rpc_page',
    );
    expect(() => validateRpcPage({ result: { latestLedger: 10, events: null } }, CONTRACT)).toThrow(
      /missing the events page/,
    );
  });

  it('rejects responses with no result or no latestLedger', () => {
    expect(() => validateRpcPage({}, CONTRACT)).toThrow(/not a getEvents result/);
    expect(() => validateRpcPage({ result: { events: [] } }, CONTRACT)).toThrow(/missing latestLedger/);
  });

  it('rejects events for another contract, without an id, or with bad topics', () => {
    const otherContract = createEvent({ id: 'e1', ledger: 5 });
    otherContract.contract_id = 'COTHERCONTRACT';
    expect(() => validateRpcPage({ result: { latestLedger: 5, events: [otherContract] } }, CONTRACT)).toThrow(
      /different contract/,
    );

    const noId = createEvent({ id: 'e2', ledger: 5 }) as Record<string, unknown>;
    delete noId.id;
    expect(() => validateRpcPage({ result: { latestLedger: 5, events: [noId] } }, CONTRACT)).toThrow(
      /no usable identifier/,
    );

    const badTopic = createEvent({ id: 'e3', ledger: 5 }) as Record<string, unknown>;
    badTopic.topic = ['only-one'];
    expect(() => validateRpcPage({ result: { latestLedger: 5, events: [badTopic] } }, CONTRACT)).toThrow(
      /invalid topic list/,
    );
  });
});

describe('backfill run: overlap, retries and failure isolation (#1937)', () => {
  it('preserves events already written by live polling and skips duplicates', async () => {
    const liveEvent = normalizeEvent(createEvent({ id: 'evt-live-1', ledger: 100, eventIndex: 0 }));
    const unrelated = normalizeEvent(createEvent({ id: 'evt-live-2', ledger: 101, eventIndex: 0 }));
    fs.writeFileSync(eventsFile, JSON.stringify([liveEvent, unrelated], null, 2));
    const before = JSON.parse(fs.readFileSync(eventsFile, 'utf-8'));

    const store = createFileBackfillStore(eventsFile, cursorFile);
    const fetchPage = vi.fn(async () =>
      page([createEvent({ id: 'evt-live-1', ledger: 100 }), createEvent({ id: 'evt-new', ledger: 100, eventIndex: 1 })], 100),
    );

    const result = await runEventBackfill({
      token: TOKEN,
      request: { startLedger: 100, endLedger: 100 },
      env: env(),
      fetchPage,
      store,
      logger: { log: () => {}, error: () => {} },
    });

    expect(result).toMatchObject({ status: 'committed', eventsProcessed: 1, eventsSkipped: 1 });
    const stored = JSON.parse(fs.readFileSync(eventsFile, 'utf-8'));
    expect(stored).toHaveLength(3);
    expect(stored.slice(0, 2)).toEqual(before);
    expect(stored.map((event: { id: string }) => event.id)).toEqual([
      'evt-live-1',
      'evt-live-2',
      'evt-new',
    ]);
    expect(backfillEventKey(stored[0])).toBe('id:evt-live-1');
  });

  it('does not persist anything when a page is missing or malformed', async () => {
    const store = createFileBackfillStore(eventsFile, cursorFile);
    const fetchPage = vi.fn(async () => ({ result: { latestLedger: 100 } }));

    await expect(
      runEventBackfill({
        token: TOKEN,
        request: { startLedger: 100, endLedger: 100 },
        env: env(),
        fetchPage,
        store,
        logger: { log: () => {}, error: () => {} },
      }),
    ).rejects.toMatchObject({ code: 'missing_rpc_page' });

    expect(fs.existsSync(eventsFile)).toBe(false);
    expect(fs.existsSync(cursorFile)).toBe(false);
  });

  it('rejects an undecodable event before writing the page', async () => {
    const store = createFileBackfillStore(eventsFile, cursorFile);
    const broken = createEvent({ id: 'evt-bad', ledger: 100 }) as Record<string, unknown>;
    broken.value = 'not-base64-xdr';

    await expect(
      runEventBackfill({
        token: TOKEN,
        request: { startLedger: 100, endLedger: 100 },
        env: env(),
        fetchPage: async () => page([broken], 100),
        store,
        logger: { log: () => {}, error: () => {} },
      }),
    ).rejects.toMatchObject({ code: 'malformed_event' });

    expect(fs.existsSync(eventsFile)).toBe(false);
    expect(fs.existsSync(cursorFile)).toBe(false);
  });

  it('retries a failed whole ledger without duplicating the events already merged', async () => {
    const store = createFileBackfillStore(eventsFile, cursorFile);
    const responses: Array<() => Promise<unknown>> = [
      async () => page([createEvent({ id: 'evt-100', ledger: 100, eventIndex: 0 })], 100),
      async () => Promise.reject(new Error('RPC 502 from https://secret.example/?api_key=leaked')),
    ];
    let call = 0;
    const fetchPage = async () => responses[call++]!();

    await expect(
      runEventBackfill({
        token: TOKEN,
        request: { startLedger: 100, endLedger: 101 },
        env: env(),
        fetchPage,
        store,
        logger: { log: () => {}, error: () => {} },
      }),
    ).rejects.toThrow(/RPC request failed/);

    // The first page is durable and its cursor points at the whole ledger.
    expect(JSON.parse(fs.readFileSync(eventsFile, 'utf-8'))).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(cursorFile, 'utf-8'))).toEqual({ ledger: 100, eventIndex: 0 });

    // Retry re-reads from the stored ledger. The already-merged event is
    // skipped; the rest of the ledger and the next ledger are committed once.
    const retryFetch = vi.fn(async ({ startLedger }: { startLedger: number }) =>
      startLedger === 100
        ? page([createEvent({ id: 'evt-100', ledger: 100, eventIndex: 0 })], 101)
        : page([createEvent({ id: 'evt-101', ledger: 101, eventIndex: 0 })], 101),
    );
    const retried = await runEventBackfill({
      token: TOKEN,
      request: { startLedger: 100, endLedger: 101 },
      env: env(),
      fetchPage: retryFetch,
      store,
      logger: { log: () => {}, error: () => {} },
    });

    expect(retried).toMatchObject({ eventsProcessed: 1, eventsSkipped: 1 });
    expect(retryFetch.mock.calls[0][0]).toMatchObject({ startLedger: 100 });
    const stored = JSON.parse(fs.readFileSync(eventsFile, 'utf-8'));
    expect(stored.map((event: { id: string }) => event.id)).toEqual(['evt-100', 'evt-101']);
    expect(JSON.parse(fs.readFileSync(cursorFile, 'utf-8'))).toEqual({ ledger: 101, eventIndex: 0 });
  });

  it('does not duplicate events when the cursor write fails after a merge', async () => {
    const store = createFileBackfillStore(eventsFile, cursorFile);
    let failCursor = true;
    const flakyStore = {
      ...store,
      saveCursor: (cursor: { ledger: number; eventIndex: number }) => {
        if (failCursor) throw new Error('simulated disk failure');
        store.saveCursor(cursor);
      },
    };
    const fetchPage = async () => page([createEvent({ id: 'evt-1', ledger: 100, eventIndex: 0 })], 100);

    await expect(
      runEventBackfill({
        token: TOKEN,
        request: { startLedger: 100, endLedger: 100 },
        env: env(),
        fetchPage,
        store: flakyStore,
        logger: { log: () => {}, error: () => {} },
      }),
    ).rejects.toThrow(/simulated disk failure/);

    expect(JSON.parse(fs.readFileSync(eventsFile, 'utf-8'))).toHaveLength(1);
    expect(fs.existsSync(cursorFile)).toBe(false);

    failCursor = false;
    const retry = await runEventBackfill({
      token: TOKEN,
      request: { startLedger: 100, endLedger: 100 },
      env: env(),
      fetchPage,
      store: flakyStore,
      logger: { log: () => {}, error: () => {} },
    });

    expect(retry).toMatchObject({ eventsProcessed: 0, eventsSkipped: 1 });
    expect(JSON.parse(fs.readFileSync(eventsFile, 'utf-8'))).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(cursorFile, 'utf-8'))).toEqual({ ledger: 100, eventIndex: 0 });
  });

  it('does not fetch when authentication or request validation fails', async () => {
    const fetchPage = vi.fn();
    const store = createFileBackfillStore(eventsFile, cursorFile);

    await expect(
      runEventBackfill({
        token: 'wrong',
        request: { startLedger: 1, endLedger: 2 },
        env: env(),
        fetchPage,
        store,
        logger: { log: () => {}, error: () => {} },
      }),
    ).rejects.toThrow(/invalid backfill operator token/);

    await expect(
      runEventBackfill({
        token: TOKEN,
        request: { startLedger: 1, endLedger: 2, rpcUrl: 'http://evil.example' },
        env: env(),
        fetchPage,
        store,
        logger: { log: () => {}, error: () => {} },
      }),
    ).rejects.toThrow(/unsupported backfill field/);

    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('never persists events beyond the requested end ledger', async () => {
    const store = createFileBackfillStore(eventsFile, cursorFile);
    const result = await runEventBackfill({
      token: TOKEN,
      request: { startLedger: 200, endLedger: 200 },
      env: env(),
      fetchPage: async () =>
        page(
          [
            createEvent({ id: 'evt-in-range', ledger: 200, eventIndex: 0 }),
            createEvent({ id: 'evt-after-range', ledger: 201, eventIndex: 0 }),
          ],
          201,
        ),
      store,
      logger: { log: () => {}, error: () => {} },
    });

    expect(result.eventsProcessed).toBe(1);
    const stored = JSON.parse(fs.readFileSync(eventsFile, 'utf-8'));
    expect(stored.map((event: { id: string }) => event.id)).toEqual(['evt-in-range']);
  });
});

// ---------------------------------------------------------------------------
// Backfill boundary behavior (#1935)
// ---------------------------------------------------------------------------
//
// These tests verify the guarantee introduced in #1935: backfill only touches
// fully-finalized ledgers and cannot race with the live poller at the network
// tip.  The first RPC page always carries a `latestLedger`; from that value
// the effective end is computed as `min(endLedger, latestLedger - 1)`.

describe('clampEndLedger (#1935)', () => {
  it('leaves endLedger unchanged when it is strictly below latestLedger', () => {
    expect(clampEndLedger(500, 100, 600)).toEqual({ effectiveEnd: 500, clamped: false });
  });

  it('clamps endLedger to latestLedger - 1 when endLedger equals latestLedger', () => {
    expect(clampEndLedger(600, 100, 600)).toEqual({ effectiveEnd: 599, clamped: true });
  });

  it('clamps endLedger to latestLedger - 1 when endLedger exceeds latestLedger', () => {
    expect(clampEndLedger(700, 100, 600)).toEqual({ effectiveEnd: 599, clamped: true });
  });

  it('throws invalid_request when the entire range is at or beyond latestLedger', () => {
    expect(() => clampEndLedger(700, 600, 600)).toThrow(BackfillError);
    try {
      clampEndLedger(700, 600, 600);
    } catch (err) {
      expect((err as BackfillError).code).toBe('invalid_request');
      expect((err as BackfillError).message).toContain('nothing to backfill');
    }
  });

  it('throws invalid_request when startLedger is beyond latestLedger - 1', () => {
    // startLedger 601 > safeMax 599
    expect(() => clampEndLedger(700, 601, 600)).toThrow(BackfillError);
  });

  it('allows a single-ledger range right below the tip', () => {
    // latestLedger=101, so safeMax=100, startLedger=100, endLedger=100
    expect(clampEndLedger(100, 100, 101)).toEqual({ effectiveEnd: 100, clamped: false });
  });
});

describe('backfill boundary: live-polling overlap and tip clamping (#1935)', () => {
  it('clamps endLedger to latestLedger - 1 and excludes events at the tip', async () => {
    const store = createFileBackfillStore(eventsFile, cursorFile);
    const logs: string[] = [];

    // Operator requests up to ledger 200, but RPC says latestLedger is 200.
    // Events at ledger 200 are potentially still being written by the live
    // poller, so the boundary clamp must exclude them.
    const result = await runEventBackfill({
      token: TOKEN,
      request: { startLedger: 100, endLedger: 200 },
      env: env(),
      fetchPage: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          latestLedger: 200,
          events: [
            createEvent({ id: 'evt-100', ledger: 100, eventIndex: 0 }),
            createEvent({ id: 'evt-199', ledger: 199, eventIndex: 0 }),
            // ledger 200 == latestLedger: must be excluded after clamping
            createEvent({ id: 'evt-200', ledger: 200, eventIndex: 0 }),
          ],
        },
      }),
      store,
      logger: {
        log: (msg: string) => logs.push(msg),
        error: () => {},
      },
    });

    expect(result.effectiveEndLedger).toBe(199);
    expect(result.eventsProcessed).toBe(2);
    const stored = JSON.parse(fs.readFileSync(eventsFile, 'utf-8'));
    expect(stored.map((e: { id: string }) => e.id)).toEqual(['evt-100', 'evt-199']);
    // Confirm the warning was logged
    expect(logs.some((l) => l.includes('endLedger clamped') && l.includes('#1935'))).toBe(true);
  });

  it('clamps when endLedger is ahead of the network tip', async () => {
    const store = createFileBackfillStore(eventsFile, cursorFile);

    // Operator asks for future ledgers; tip is 150.
    const result = await runEventBackfill({
      token: TOKEN,
      request: { startLedger: 100, endLedger: 300 },
      env: env(),
      fetchPage: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          latestLedger: 150,
          events: [
            createEvent({ id: 'evt-100', ledger: 100, eventIndex: 0 }),
            createEvent({ id: 'evt-149', ledger: 149, eventIndex: 0 }),
            // ledger 150 and above are excluded after clamping to 149
            createEvent({ id: 'evt-150', ledger: 150, eventIndex: 0 }),
            createEvent({ id: 'evt-200', ledger: 200, eventIndex: 0 }),
          ],
        },
      }),
      store,
      logger: { log: () => {}, error: () => {} },
    });

    expect(result.effectiveEndLedger).toBe(149);
    expect(result.eventsProcessed).toBe(2);
    const stored = JSON.parse(fs.readFileSync(eventsFile, 'utf-8'));
    expect(stored.map((e: { id: string }) => e.id)).toEqual(['evt-100', 'evt-149']);
  });

  it('rejects with invalid_request when the entire range is at the tip or beyond', async () => {
    const store = createFileBackfillStore(eventsFile, cursorFile);

    // startLedger 200, latestLedger 200 → safeMax 199 < startLedger → nothing to backfill.
    await expect(
      runEventBackfill({
        token: TOKEN,
        request: { startLedger: 200, endLedger: 200 },
        env: env(),
        fetchPage: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            latestLedger: 200,
            events: [],
          },
        }),
        store,
        logger: { log: () => {}, error: () => {} },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });

    // No events written
    expect(fs.existsSync(eventsFile)).toBe(false);
  });

  it('does not clamp when endLedger is strictly below latestLedger and no warning is emitted', async () => {
    const store = createFileBackfillStore(eventsFile, cursorFile);
    const logs: string[] = [];

    const result = await runEventBackfill({
      token: TOKEN,
      request: { startLedger: 100, endLedger: 198 },
      env: env(),
      fetchPage: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          latestLedger: 200,
          events: [
            createEvent({ id: 'evt-100', ledger: 100, eventIndex: 0 }),
            createEvent({ id: 'evt-198', ledger: 198, eventIndex: 0 }),
          ],
        },
      }),
      store,
      logger: {
        log: (msg: string) => logs.push(msg),
        error: () => {},
      },
    });

    expect(result.effectiveEndLedger).toBe(198);
    expect(result.eventsProcessed).toBe(2);
    expect(logs.some((l) => l.includes('clamped'))).toBe(false);
  });

  it('preserves live-polled events when backfill is clamped', async () => {
    // A live event at ledger 200 is already in the store (written by the live poller).
    // Backfill requests 100-200 but latestLedger=200, so clamped to 199.
    // The existing event at ledger 200 must not be touched.
    const liveEvent = { id: 'evt-live-200', ledger: 200, type: 'create' };
    fs.writeFileSync(eventsFile, JSON.stringify([liveEvent], null, 2));

    const store = createFileBackfillStore(eventsFile, cursorFile);

    await runEventBackfill({
      token: TOKEN,
      request: { startLedger: 100, endLedger: 200 },
      env: env(),
      fetchPage: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          latestLedger: 200,
          events: [
            createEvent({ id: 'evt-100', ledger: 100, eventIndex: 0 }),
          ],
        },
      }),
      store,
      logger: { log: () => {}, error: () => {} },
    });

    const stored = JSON.parse(fs.readFileSync(eventsFile, 'utf-8'));
    // The live event at 200 survives; the backfill event at 100 is appended
    expect(stored.map((e: { id: string }) => e.id)).toEqual(['evt-live-200', 'evt-100']);
  });
});
