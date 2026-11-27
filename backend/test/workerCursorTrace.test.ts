import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

import { pollEvents } from '../worker/indexer.js';
import {
  CURSOR_TRACE_EVENT,
  buildCursorTrace,
  createCursorTrace,
  redactCursorReference,
  // @ts-expect-error — plain JS worker module, no type declarations
} from '../worker/cursorTrace.js';

type TraceRecord = {
  event: string;
  outcome: 'pending' | 'committed';
  at: string;
  eventRef: string | null;
  ledger: number | null;
  type: string | null;
  bountyId: string | null;
  cursorFrom: string | null;
  cursorTo: string | null;
  cursorAdvanced: boolean;
};

const post = vi.mocked(axios.post);
const CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

describe('redactCursorReference (#1933)', () => {
  it('maps a token to a stable, prefixed, truncated digest', () => {
    const first = redactCursorReference('cursor-2');
    expect(first).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(redactCursorReference('cursor-2')).toBe(first);
    expect(redactCursorReference('cursor-3')).not.toBe(first);
  });

  it('never echoes the raw token', () => {
    const ref = redactCursorReference('cursor-super-secret-paging-token');
    expect(ref).not.toContain('cursor-super-secret-paging-token');
    expect(ref).not.toContain('super-secret');
  });

  it('returns null for values that are not non-empty strings', () => {
    expect(redactCursorReference(undefined)).toBeNull();
    expect(redactCursorReference(null)).toBeNull();
    expect(redactCursorReference('')).toBeNull();
    expect(redactCursorReference(42)).toBeNull();
  });
});

describe('buildCursorTrace (#1933)', () => {
  const event = {
    id: 'event-42',
    type: 'release',
    bountyId: '12',
    ledger: 42,
    raw: { payload: 'x'.repeat(10_000), contributor: 'GABC' },
    amount: '500',
  };

  it('records only redacted references and public chain metadata', () => {
    const record = buildCursorTrace({
      outcome: 'pending',
      event,
      cursorFrom: 'cursor-1',
      cursorTo: 'cursor-2',
      cursorAdvanced: true,
    }) as TraceRecord;

    expect(record).toMatchObject({
      event: CURSOR_TRACE_EVENT,
      outcome: 'pending',
      eventRef: redactCursorReference('event-42'),
      ledger: 42,
      type: 'release',
      bountyId: '12',
      cursorFrom: redactCursorReference('cursor-1'),
      cursorTo: redactCursorReference('cursor-2'),
      cursorAdvanced: true,
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('event-42');
    expect(serialized).not.toContain('cursor-1');
    expect(serialized).not.toContain('cursor-2');
    expect(serialized).not.toContain('x'.repeat(64));
    expect(serialized).not.toContain('GABC');
  });

  it('rejects an outcome outside pending/committed', () => {
    expect(() => buildCursorTrace({ outcome: 'done' })).toThrow(/unknown cursor trace outcome/);
  });
});

describe('createCursorTrace (#1933)', () => {
  it('emits one pending then one committed record and returns them', () => {
    const records: TraceRecord[] = [];
    const trace = createCursorTrace((record: TraceRecord) => records.push(record));

    const pending = trace.pending({ event: { id: 'event-a', ledger: 7 } });
    const committed = trace.committed({ event: { id: 'event-a', ledger: 7 } });

    expect(records.map((record) => record.outcome)).toEqual(['pending', 'committed']);
    expect(pending).toEqual(records[0]);
    expect(committed).toEqual(records[1]);
    expect(pending.eventRef).toBe(committed.eventRef);
  });

  it('requires a callable sink', () => {
    expect(() => createCursorTrace(undefined)).toThrow(/sink must be a function/);
  });
});

describe('indexer cursor outcome tracing (#1933)', () => {
  let directory: string;
  let indexFile: string;
  let cursorFile: string;
  let records: TraceRecord[];
  let eventsOnDiskWhenPending: unknown[][];

  function readEvents(): Array<{ id: string }> {
    return JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  }

  function readCursor(): string {
    return JSON.parse(fs.readFileSync(cursorFile, 'utf8')).cursor;
  }

  function rpcResult(events: Array<{ id: string; ledger?: number }>, cursor: string) {
    return { data: { result: { events, cursor } } };
  }

  function poll() {
    return pollEvents({
      indexFile,
      cursorFile,
      rpcUrl: 'https://rpc.example.test',
      contractId: CONTRACT,
      startLedger: 100,
      maxRetries: 1,
      trace: createCursorTrace((record: TraceRecord) => {
        records.push(record);
        if (record.outcome === 'pending') {
          eventsOnDiskWhenPending.push(fs.existsSync(indexFile) ? readEvents() : []);
        }
      }),
    });
  }

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soroban-cursor-trace-'));
    indexFile = path.join(directory, 'indexed-events.json');
    cursorFile = path.join(directory, 'indexed-events.cursor.json');
    records = [];
    eventsOnDiskWhenPending = [];
    post.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('traces each new event as pending before it is durable and committed after', async () => {
    post.mockResolvedValueOnce(
      rpcResult(
        [
          { id: 'event-a', ledger: 100 },
          { id: 'event-b', ledger: 101 },
        ],
        'cursor-2',
      ),
    );

    await poll();

    expect(records.map((record) => record.outcome)).toEqual([
      'pending',
      'pending',
      'committed',
      'committed',
    ]);
    // Nothing was durable when the pending records were emitted.
    expect(eventsOnDiskWhenPending).toEqual([[], []]);
    expect(records.map((record) => record.ledger)).toEqual([100, 101, 100, 101]);
    expect(records.every((record) => record.cursorTo === redactCursorReference('cursor-2'))).toBe(
      true,
    );
    expect(records.every((record) => record.cursorAdvanced)).toBe(true);
    expect(readCursor()).toBe('cursor-2');
  });

  it('leaves the interrupted events pending when the store write fails, then commits on replay', async () => {
    post.mockResolvedValue(rpcResult([{ id: 'event-a', ledger: 100 }], 'cursor-2'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Force the atomic write to fail after processing but before persistence
    // by placing the events file under a path that cannot become a directory.
    const blockedParent = path.join(directory, 'blocked');
    fs.writeFileSync(blockedParent, 'not a directory');
    indexFile = path.join(blockedParent, 'indexed-events.json');

    await poll();

    expect(records.map((record) => record.outcome)).toEqual(['pending']);
    expect(fs.existsSync(indexFile)).toBe(false);
    expect(fs.existsSync(cursorFile)).toBe(false);

    // Restart: the blocking path is gone, so the replayed page commits.
    fs.rmSync(blockedParent);
    await poll();

    expect(records.map((record) => record.outcome)).toEqual(['pending', 'pending', 'committed']);
    expect(records[0].eventRef).toBe(records[1].eventRef);
    expect(records[1].eventRef).toBe(records[2].eventRef);
    expect(readEvents().map((event) => event.id)).toEqual(['event-a']);
    expect(readCursor()).toBe('cursor-2');
  });

  it('emits no trace for a page with only already-indexed events', async () => {
    post
      .mockResolvedValueOnce(rpcResult([{ id: 'event-a', ledger: 100 }], 'cursor-2'))
      .mockResolvedValueOnce(rpcResult([{ id: 'event-a', ledger: 100 }], 'cursor-2'));
    await poll();
    records = [];

    await poll();

    expect(records).toEqual([]);
    expect(readEvents().map((event) => event.id)).toEqual(['event-a']);
  });
});
