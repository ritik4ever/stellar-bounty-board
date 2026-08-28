import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const getMock = vi.mocked(axios.get);

/**
 * The worker module keeps module-level scheduler state (timer + consecutive
 * failure counter), so it is re-imported fresh for every test after setting
 * the environment variables it reads at import time.
 */
async function loadWorker(): Promise<typeof import('../worker/indexer.mjs')> {
  vi.resetModules();
  return await import('../worker/indexer.mjs');
}

describe('soroban event indexer worker (issue #809)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete process.env.SOROBAN_POLL_INTERVAL_MS;
    delete process.env.SOROBAN_MAX_BACKOFF_MS;
    delete process.env.SOROBAN_MAX_RETRIES;
  });

  it('polls immediately, then at the configured base interval while RPC succeeds', async () => {
    process.env.SOROBAN_POLL_INTERVAL_MS = '5000';
    process.env.SOROBAN_MAX_BACKOFF_MS = '30000';
    getMock.mockResolvedValue({ data: { events: [] } });

    const { startWorker } = await loadWorker();
    startWorker();

    // First poll fires immediately.
    await vi.advanceTimersByTimeAsync(0);
    expect(getMock).toHaveBeenCalledTimes(1);

    // No poll before the 5s interval elapses...
    await vi.advanceTimersByTimeAsync(4999);
    expect(getMock).toHaveBeenCalledTimes(1);

    // ...and exactly one when it does.
    await vi.advanceTimersByTimeAsync(1);
    expect(getMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(getMock).toHaveBeenCalledTimes(3);
  });

  it('backs off exponentially on repeated RPC errors, capped at the max backoff', async () => {
    process.env.SOROBAN_POLL_INTERVAL_MS = '1000';
    process.env.SOROBAN_MAX_BACKOFF_MS = '5000';
    // One attempt per poll so the poll itself fails immediately and the
    // poll-level backoff timing below is deterministic.
    process.env.SOROBAN_MAX_RETRIES = '1';
    getMock.mockRejectedValue(new Error('RPC timeout'));

    const { startWorker } = await loadWorker();
    startWorker();

    // Failure #1 → next poll in 1000 * 2^1 = 2000ms.
    await vi.advanceTimersByTimeAsync(0);
    expect(getMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(getMock).toHaveBeenCalledTimes(1);

    // Failure #2 → next poll in 1000 * 2^2 = 4000ms.
    await vi.advanceTimersByTimeAsync(1);
    expect(getMock).toHaveBeenCalledTimes(2);

    // Failure #3 → min(1000 * 2^3, 5000) = 5000ms (capped, not 8000ms).
    await vi.advanceTimersByTimeAsync(4000);
    expect(getMock).toHaveBeenCalledTimes(3);

    // Failure #4 and #5 → still 5000ms apart (cap holds).
    await vi.advanceTimersByTimeAsync(5000);
    expect(getMock).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(4999);
    expect(getMock).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(1);
    expect(getMock).toHaveBeenCalledTimes(5);
  });

  it('resets the poll interval to baseline after a successful poll', async () => {
    process.env.SOROBAN_POLL_INTERVAL_MS = '1000';
    process.env.SOROBAN_MAX_BACKOFF_MS = '5000';
    process.env.SOROBAN_MAX_RETRIES = '1';
    getMock
      .mockRejectedValueOnce(new Error('RPC error 1'))
      .mockRejectedValueOnce(new Error('RPC error 2'))
      .mockResolvedValue({ data: { events: [] } });

    const { startWorker } = await loadWorker();
    startWorker();

    // failure #1 (t=0) → next at 2000ms; failure #2 (t=2000) → next at 6000ms.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    // success at t=6000 → backoff resets, next poll at 6000 + 1000 = 7000ms.
    await vi.advanceTimersByTimeAsync(4000);
    expect(getMock).toHaveBeenCalledTimes(3);

    // The post-success gap is the base interval, not a backoff delay.
    await vi.advanceTimersByTimeAsync(999);
    expect(getMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(1);
    expect(getMock).toHaveBeenCalledTimes(4);
  });

  it('falls back to defaults when the env configuration is invalid', async () => {
    process.env.SOROBAN_POLL_INTERVAL_MS = 'not-a-number';
    process.env.SOROBAN_MAX_BACKOFF_MS = '-5';
    process.env.SOROBAN_MAX_RETRIES = '1';
    getMock.mockResolvedValue({ data: { events: [] } });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { startWorker } = await loadWorker();
    startWorker();

    await vi.advanceTimersByTimeAsync(0);
    expect(getMock).toHaveBeenCalledTimes(1);

    // Invalid interval falls back to the 10_000ms default.
    await vi.advanceTimersByTimeAsync(9999);
    expect(getMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(getMock).toHaveBeenCalledTimes(2);

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
