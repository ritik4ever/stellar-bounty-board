import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error - plain JS worker module
import { pollEvents } from '../worker/indexer.js';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));
const post = vi.mocked(axios.post);
const invalidTokens = [
  '',
  ' ',
  'token\n',
  'x'.repeat(257),
  'https://rpc.test/?key=secret',
  '../../secret',
  '\u0000',
  '\u00e9',
  123,
  null,
  false,
  [],
  { cursor: 'nested' },
];
let directory: string;
let indexFile: string;
let cursorFile: string;
function poll(startLedger: unknown = 100, maxRetries = 1) {
  return pollEvents({
    indexFile,
    cursorFile,
    startLedger,
    maxRetries,
    rpcUrl: 'https://rpc.example.test',
    contractId: 'test-contract',
  });
}
function seed() {
  fs.writeFileSync(indexFile, JSON.stringify([{ id: 'event-99', ledger: 99 }]));
  fs.writeFileSync(cursorFile, JSON.stringify({ cursor: 'cursor-99' }));
}
function read(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function reply(events: unknown = [], cursor: unknown = 'cursor-100') {
  return { data: { result: { events, cursor } } };
}
function logs() {
  return [console.log, console.warn, console.error]
    .flatMap((fn) => vi.mocked(fn).mock.calls)
    .flat()
    .join('\n');
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'indexer-input-'));
  indexFile = path.join(directory, 'events.json');
  cursorFile = path.join(directory, 'cursor.json');
  post.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(directory, { recursive: true, force: true });
});
describe('indexer cursor input validation (#1932)', () => {
  it.each(invalidTokens.map((value, i) => [i, value]))(
    'rejects invalid checkpoint %s without an RPC call or state mutation',
    async (_, cursor) => {
      fs.writeFileSync(cursorFile, JSON.stringify({ cursor }));
      const before = fs.readFileSync(cursorFile, 'utf8');
      await poll();
      expect(post).not.toHaveBeenCalled();
      expect(fs.existsSync(indexFile)).toBe(false);
      expect(fs.readFileSync(cursorFile, 'utf8')).toBe(before);
    }
  );
  it.each(invalidTokens.map((value, i) => [i, value]))(
    'rejects invalid RPC cursor %s before committing either file',
    async (_, cursor) => {
      seed();
      post.mockResolvedValueOnce(reply([{ id: 'event-100', ledger: 100 }], cursor));
      await poll();
      expect(read(indexFile)).toEqual([{ id: 'event-99', ledger: 99 }]);
      expect(read(cursorFile)).toEqual({ cursor: 'cursor-99' });
    }
  );
  it.each(['id', 'cursor', 'paging_token', 'pagingToken'])(
    'rejects poisoned event %s even when the response cursor is valid',
    async (field) => {
      seed();
      post.mockResolvedValueOnce(
        reply([
          { id: 'event-100-a', ledger: 100 },
          { id: 'event-100-b', ledger: 100, [field]: 'secret\nforged-log' },
        ])
      );
      await poll();
      expect(read(indexFile)).toHaveLength(1);
      expect(read(cursorFile).cursor).toBe('cursor-99');
      expect(logs()).not.toContain('secret');
    }
  );
  it.each([undefined, null, {}, 'events'])(
    'rejects a missing or malformed events page (%s)',
    async (events) => {
      seed();
      post.mockResolvedValueOnce({ data: { result: { events, cursor: 'cursor-101' } } });
      await poll();
      expect(read(indexFile)).toHaveLength(1);
      expect(read(cursorFile).cursor).toBe('cursor-99');
    }
  );
  it('rejects a response containing both an RPC error and result', async () => {
    seed();
    post.mockResolvedValueOnce({
      data: {
        ...reply([{ id: 'event-100' }]).data,
        error: { message: 'provider-secret' },
      },
    });
    await poll();
    expect(read(indexFile)).toHaveLength(1);
    expect(read(cursorFile).cursor).toBe('cursor-99');
    expect(logs()).not.toContain('provider-secret');
  });
  it.each([null, [], 'event'])('rejects malformed page entries (%s)', async (event) => {
    seed();
    post.mockResolvedValueOnce(reply([{ id: 'event-100' }, event]));
    await poll();
    expect(read(indexFile)).toHaveLength(1);
    expect(read(cursorFile).cursor).toBe('cursor-99');
  });
  it('validates the legacy event ID before using it as a recovery cursor', async () => {
    fs.writeFileSync(indexFile, JSON.stringify([{ id: { token: 'secret' } }]));
    await poll();
    expect(post).not.toHaveBeenCalled();
    expect(fs.existsSync(cursorFile)).toBe(false);
  });
  it('recovers a corrupt checkpoint from a valid durable event ID without logging contents', async () => {
    fs.writeFileSync(indexFile, JSON.stringify([{ id: 'event-100-b', ledger: 100 }]));
    fs.writeFileSync(cursorFile, '{"cursor":"checkpoint-secret');
    post.mockResolvedValueOnce(reply([{ id: 'event-100-c', ledger: 100 }]));
    await poll();
    expect(post.mock.calls[0][1].params.pagination.cursor).toBe('event-100-b');
    expect(read(indexFile)).toHaveLength(2);
    expect(read(cursorFile).cursor).toBe('cursor-100');
    expect(logs()).not.toContain('checkpoint-secret');
  });
  it.each([-1, 0, 1.5, Infinity, 4294967296, '', ' ', '100\n', '1e2', '0x64', true, [], {}])(
    'rejects invalid initial ledger %s before RPC',
    async (ledger) => {
      await poll(ledger);
      expect(post).not.toHaveBeenCalled();
      expect(fs.existsSync(indexFile)).toBe(false);
    }
  );
  it.each(['100', 4294967295])('accepts valid initial ledger %s', async (ledger) => {
    post.mockResolvedValueOnce(reply());
    await poll(ledger);
    expect(post.mock.calls[0][1].params.startLedger).toBe(Number(ledger));
  });
  it('preserves opaque tokens and advances an empty page without logging tokens', async () => {
    const token = 'A'.repeat(250) + '+/=_-Z';
    fs.writeFileSync(cursorFile, JSON.stringify({ cursor: token }));
    post.mockResolvedValueOnce(reply([], 'next-token'));
    await poll();
    expect(post.mock.calls[0][1].params.pagination.cursor).toBe(token);
    expect(read(cursorFile).cursor).toBe('next-token');
    expect(logs()).not.toContain('next-token');
    expect(fs.existsSync(indexFile)).toBe(false);
  });
  it('uses a valid last event ID if the RPC omits its cursor', async () => {
    post.mockResolvedValueOnce({
      data: {
        result: {
          events: [
            { id: '0000000429496729600-0000000000', ledger: 100 },
            { id: '0000000429496729600-0000000001', ledger: 100 },
          ],
        },
      },
    });
    await poll();
    expect(read(indexFile)).toHaveLength(2);
    expect(read(cursorFile).cursor).toBe('0000000429496729600-0000000001');
  });
  it('replays two same-ledger events once after a checkpoint write failure', async () => {
    seed();
    const events = [
      { id: 'event-100-a', ledger: 100 },
      { id: 'event-100-b', ledger: 100 },
    ];
    const rename = fs.renameSync;
    const failure = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === cursorFile) throw new Error('write-failure-secret');
      return rename(from, to);
    });
    post.mockResolvedValueOnce(reply(events));
    await poll();
    expect(read(indexFile).map((e: { id: string }) => e.id)).toEqual([
      'event-99',
      'event-100-a',
      'event-100-b',
    ]);
    expect(read(cursorFile).cursor).toBe('cursor-99');
    expect(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    failure.mockRestore();
    // pollEvents reloads both files each invocation, as on a process restart.
    post.mockResolvedValueOnce(reply(events));
    await poll();
    expect(post.mock.calls[1][1].params.pagination.cursor).toBe('cursor-99');
    expect(read(indexFile)).toHaveLength(3);
    expect(read(cursorFile).cursor).toBe('cursor-100');
    expect(logs()).not.toContain('write-failure-secret');
  });
  it('does not log provider secrets on retry or final failure', async () => {
    vi.useFakeTimers();
    post.mockRejectedValue(new Error('https://provider.test/?api-key=private-secret'));
    const polling = poll(100, 2);
    await vi.runAllTimersAsync();
    await polling;
    expect(post).toHaveBeenCalledTimes(2);
    expect(logs()).not.toContain('private-secret');
    expect(fs.existsSync(indexFile)).toBe(false);
    expect(fs.existsSync(cursorFile)).toBe(false);
  });

  it('rejects malformed persisted events without overwriting them or logging contents', async () => {
    fs.writeFileSync(indexFile, '{"secret":"store-secret"}');
    const before = fs.readFileSync(indexFile, 'utf8');
    await poll();
    expect(post).not.toHaveBeenCalled();
    expect(fs.readFileSync(indexFile, 'utf8')).toBe(before);
    expect(logs()).not.toContain('store-secret');
  });
  it('rejects a nonempty page with no usable pagination boundary', async () => {
    seed();
    post.mockResolvedValueOnce({ data: { result: { events: [{ ledger: 100, event_index: 0 }] } } });
    await poll();
    expect(read(indexFile)).toHaveLength(1);
    expect(read(cursorFile).cursor).toBe('cursor-99');
  });
  it.each(['null', '[]', '{}', '{"cursor":"secret'])(
    'fails closed for an unusable checkpoint with no persisted recovery ID (%s)',
    async (contents) => {
      fs.writeFileSync(cursorFile, contents);
      await poll();
      expect(post).not.toHaveBeenCalled();
      expect(fs.readFileSync(cursorFile, 'utf8')).toBe(contents);
      expect(logs()).not.toContain('secret');
    }
  );
});
