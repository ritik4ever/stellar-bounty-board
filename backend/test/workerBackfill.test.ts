import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
